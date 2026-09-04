import { beforeEach, describe, expect, it } from "vitest";
import { ITEMS } from "./plan";
import {
  BLINDSPOTS_KEY,
  COVERAGE_GAP_THRESHOLD,
  TOPIC_RULES,
  blindspotId,
  blindspotScore,
  canonicalTopic,
  coverageGaps,
  isRecordable,
  loadBlindspots,
  mergeBlindspot,
  newThisWeek,
  noteBlindspot,
  parseBlindspots,
  rankBlindspots,
  readLocalBlindspots,
  setBlindspotStatus,
  shouldRecordUnknown,
  suggestPlanItems,
  topicLabel,
  writeLocalBlindspots,
  type Blindspot,
  type BlindspotInput,
} from "./blindspots";
import { buildCorrectionDraft, sourceLine, sourceStamp } from "../tools/blindspot";

// vitest 默认 node 环境没有 localStorage，装一个最小实现来测降级分支
class MemStorage {
  private m = new Map<string, string>();
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  get length() { return this.m.size; }
}

beforeEach(() => {
  (globalThis as any).localStorage = new MemStorage();
});

const T0 = Date.UTC(2026, 8, 1);
const DAY = 24 * 3600 * 1000;

const input = (over: Partial<BlindspotInput> = {}): BlindspotInput => ({
  kind: "wrong_metric",
  topic: "可用量口径",
  title: "拿现存量当可用量下单",
  evidence: "现存量还有 8000，够了吧",
  why: "现存量里有被别的订单预占的，照它算会少下单，开线才发现料被领走了",
  fix: "算缺口只认可用量那一列",
  linkedItemIds: [],
  ...over,
});

describe("mergeBlindspot · 合并而不是堆积", () => {
  it("新主题建一条：occurrences=1、status=open、id 由 kind+主题决定", () => {
    const list = mergeBlindspot([], input(), T0);
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(blindspotId("wrong_metric", "available-qty"));
    expect(list[0].occurrences).toBe(1);
    expect(list[0].status).toBe("open");
    expect(list[0].firstSeenAt).toBe(T0);
    expect(list[0].lastSeenAt).toBe(T0);
  });

  it("幂等：反复记同一条，列表长度不增长", () => {
    let list = mergeBlindspot([], input(), T0);
    list = mergeBlindspot(list, input(), T0 + DAY);
    list = mergeBlindspot(list, input(), T0 + 2 * DAY);
    expect(list).toHaveLength(1);
  });

  it("合并计数：occurrences 累加，firstSeenAt 保留、lastSeenAt 刷新", () => {
    let list = mergeBlindspot([], input(), T0);
    list = mergeBlindspot(list, input(), T0 + DAY);
    expect(list[0].occurrences).toBe(2);
    expect(list[0].firstSeenAt).toBe(T0);
    expect(list[0].lastSeenAt).toBe(T0 + DAY);
  });

  it("同主题不同措辞要合并：「可用库存」「现存量那个数」归到同一条", () => {
    let list = mergeBlindspot([], input({ topic: "可用量口径" }), T0);
    list = mergeBlindspot(list, input({ topic: "可用库存", title: "把可用库存看成现存量" }), T0 + DAY);
    list = mergeBlindspot(list, input({ topic: "现存量那个数", title: "库存有多少没看对" }), T0 + 2 * DAY);
    expect(list).toHaveLength(1);
    expect(list[0].occurrences).toBe(3);
    expect(list[0].topic).toBe("available-qty");
  });

  it("同主题但类型不同 ⇒ 两条（记反了和不知道不是一回事）", () => {
    let list = mergeBlindspot([], input(), T0);
    list = mergeBlindspot(list, input({ kind: "unknown", title: "问可用量在哪列看" }), T0 + DAY);
    expect(list).toHaveLength(2);
  });

  it("已经标了「已经懂了」又犯 ⇒ 自动顶回 open", () => {
    let list = mergeBlindspot([], input(), T0);
    list = [{ ...list[0], status: "cleared" }];
    list = mergeBlindspot(list, input(), T0 + DAY);
    expect(list[0].status).toBe("open");
    expect(list[0].occurrences).toBe(2);
  });

  it("evidence 取最新原话；新的一次没给原话时保留旧的", () => {
    let list = mergeBlindspot([], input({ evidence: "第一句原话" }), T0);
    list = mergeBlindspot(list, input({ evidence: "第二句原话" }), T0 + DAY);
    expect(list[0].evidence).toBe("第二句原话");
    list = mergeBlindspot(list, input({ evidence: "  " }), T0 + 2 * DAY);
    expect(list[0].evidence).toBe("第二句原话");
  });

  it("linkedItemIds 取并集，且只保留 plan.ts 里真实存在的 id", () => {
    const list = mergeBlindspot([], input({ linkedItemIds: ["B1-available-qty", "不存在的条目"] }), T0);
    expect(list[0].linkedItemIds).toEqual(["B1-available-qty"]);
    const merged = mergeBlindspot(list, input({ linkedItemIds: ["S1-stock-query"] }), T0 + DAY);
    expect(merged[0].linkedItemIds.sort()).toEqual(["B1-available-qty", "S1-stock-query"]);
  });
});

describe("rankBlindspots · 反复出现 + 后果重 的排前面", () => {
  const make = (over: Partial<Blindspot>): Blindspot => ({
    id: "x", kind: "unknown", topic: "t", title: "t", evidence: "e", why: "w", fix: "f",
    linkedItemIds: [], occurrences: 1, firstSeenAt: T0, lastSeenAt: T0, status: "open", ...over,
  });

  it("后果重的排前面：用错口径 > 记反了 > 还不知道", () => {
    const list = [
      make({ id: "a", kind: "unknown" }),
      make({ id: "b", kind: "wrong_metric" }),
      make({ id: "c", kind: "misconception" }),
    ];
    expect(rankBlindspots(list).map((b) => b.id)).toEqual(["b", "c", "a"]);
  });

  it("同类型下出现次数多的靠前，且封顶 5 次", () => {
    const list = [make({ id: "a", occurrences: 1 }), make({ id: "b", occurrences: 4 })];
    expect(rankBlindspots(list)[0].id).toBe("b");
    expect(blindspotScore(make({ occurrences: 5 }))).toBe(blindspotScore(make({ occurrences: 99 })));
  });

  it("稳定排序：同分按 lastSeenAt、再按 id；两次排序结果一致，且不改原数组", () => {
    const list = [
      make({ id: "c", lastSeenAt: T0 }),
      make({ id: "a", lastSeenAt: T0 }),
      make({ id: "b", lastSeenAt: T0 + DAY }),
    ];
    const once = rankBlindspots(list).map((b) => b.id);
    const twice = rankBlindspots(rankBlindspots(list)).map((b) => b.id);
    expect(once).toEqual(["b", "a", "c"]);
    expect(twice).toEqual(once);
    expect(list.map((b) => b.id)).toEqual(["c", "a", "b"]);
  });

  it("open > learning > cleared（清掉的沉底）", () => {
    const list = [make({ id: "a", status: "cleared" }), make({ id: "b", status: "learning" }), make({ id: "c", status: "open" })];
    expect(rankBlindspots(list).map((b) => b.id)).toEqual(["c", "b", "a"]);
  });
});

describe("suggestPlanItems · 必须指向真实存在的学习条目", () => {
  const ids = new Set(ITEMS.map((i) => i.id));

  it("TOPIC_RULES 里每个 itemId 都在 plan.ts 里存在，且主题 key 唯一", () => {
    for (const r of TOPIC_RULES) {
      expect(r.itemIds.length, r.topic).toBeGreaterThan(0);
      for (const id of r.itemIds) expect(ids.has(id), `${r.topic} 指向了不存在的条目 ${id}`).toBe(true);
    }
    expect(new Set(TOPIC_RULES.map((r) => r.topic)).size).toBe(TOPIC_RULES.length);
  });

  it("按主题直接命中", () => {
    expect(suggestPlanItems({ topic: "回签才算承诺", title: "", fix: "", evidence: "" })).toEqual(["V1-signback"]);
  });

  it("主题是她自己的说法时靠关键词兜底", () => {
    const got = suggestPlanItems({ topic: "他微信说好了", title: "口头答应就算数", fix: "要回签", evidence: "他说收到了" });
    expect(got).toContain("V1-signback");
  });

  it("完全对不上任何主题 ⇒ 返回空数组（调用方据此丢弃）", () => {
    expect(suggestPlanItems({ topic: "食堂几点开饭", title: "不知道食堂时间", fix: "去问前台", evidence: "几点吃饭" })).toEqual([]);
  });
});

describe("isRecordable · 三条同时成立才算一条盲区", () => {
  it("没有原话证据 ⇒ 不记", () => {
    expect(isRecordable(input({ evidence: "   " }))).toBe(false);
  });

  it("对不上任何学习条目（一次性事实）⇒ 不记", () => {
    expect(isRecordable(input({ topic: "供应商电话", title: "不记得对接人电话", fix: "存通讯录", evidence: "他电话多少来着" }))).toBe(false);
  });

  it("三条都满足 ⇒ 记", () => {
    expect(isRecordable(input())).toBe(true);
  });
});

describe("coverageGaps · 哪些主题反复出问题", () => {
  const at = (topic: string, occurrences: number, status: Blindspot["status"] = "open"): Blindspot => ({
    id: `bs-wrong_metric-${topic}`, kind: "wrong_metric", topic, title: "t", evidence: "e", why: "w", fix: "f",
    linkedItemIds: [], occurrences, firstSeenAt: T0, lastSeenAt: T0, status,
  });

  it(`低于阈值（${COVERAGE_GAP_THRESHOLD} 次）不提醒，达到阈值才提醒`, () => {
    expect(coverageGaps([at("available-qty", COVERAGE_GAP_THRESHOLD - 1)])).toEqual([]);
    const gaps = coverageGaps([at("available-qty", COVERAGE_GAP_THRESHOLD)]);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].topic).toBe("available-qty");
    expect(gaps[0].hint.length).toBeGreaterThan(10);
  });

  it("同一主题多条累加计数；已清掉的不计", () => {
    expect(coverageGaps([at("in-transit", 2), { ...at("in-transit", 1), id: "bs-process_gap-in-transit", kind: "process_gap" }])).toHaveLength(1);
    expect(coverageGaps([at("in-transit", 5, "cleared")])).toEqual([]);
  });

  it("按累计次数降序", () => {
    const gaps = coverageGaps([at("available-qty", 3), at("signback", 6)]);
    expect(gaps.map((g) => g.topic)).toEqual(["signback", "available-qty"]);
  });
});

describe("unknown 抑制阀 / 主题归一 / 本周新增", () => {
  it("同一主题第一次问只答不记，第二次才记", () => {
    const asked = new Set<string>();
    expect(shouldRecordUnknown([], "暂估入库", asked)).toBe(false);
    expect(shouldRecordUnknown([], "暂估是什么意思", asked)).toBe(true);
  });

  it("这个主题已经有记录了 ⇒ 直接算第二次", () => {
    const existing = [{ ...(mergeBlindspot([], input(), T0)[0]) }];
    expect(shouldRecordUnknown(existing, "可用库存", new Set())).toBe(true);
  });

  it("canonicalTopic / topicLabel 稳定可逆", () => {
    expect(canonicalTopic("available-qty")).toBe("available-qty");
    expect(canonicalTopic("可用量口径")).toBe("available-qty");
    expect(topicLabel("available-qty")).toBe("可用量口径");
    expect(topicLabel("没见过的主题")).toBe("没见过的主题");
  });

  it("newThisWeek 只数近 7 天首次出现的", () => {
    const now = T0 + 30 * DAY;
    let list = mergeBlindspot([], input(), now - 2 * DAY);
    list = mergeBlindspot(list, input({ kind: "process_gap", topic: "回签" }), now - 20 * DAY);
    expect(newThisWeek(list, now)).toBe(1);
  });
});

describe("存取 · 降级到 localStorage", () => {
  it("写进去再读出来是同一份", async () => {
    const list = mergeBlindspot([], input(), T0);
    writeLocalBlindspots(list);
    expect(localStorage.getItem(BLINDSPOTS_KEY)).toBeTruthy();
    expect(readLocalBlindspots()).toEqual(list);
    await expect(loadBlindspots()).resolves.toEqual(list);
  });

  it("存坏了返回空列表，不抛错", () => {
    localStorage.setItem(BLINDSPOTS_KEY, "{不是 JSON");
    expect(readLocalBlindspots()).toEqual([]);
  });

  it("parseBlindspots 丢掉缺字段的坏行、按 id 去重", () => {
    const good = mergeBlindspot([], input(), T0)[0];
    expect(parseBlindspots([good, good, { kind: "wrong_metric" }, null, "x"])).toHaveLength(1);
  });

  it("noteBlindspot 落盘并在第二次调用时合并计数", async () => {
    await noteBlindspot(input(), T0);
    const after = await noteBlindspot(input(), T0 + DAY);
    expect(after).toHaveLength(1);
    expect(after[0].occurrences).toBe(2);
    expect(readLocalBlindspots()[0].occurrences).toBe(2);
  });

  it("noteBlindspot 对不满足判定标准的输入静默不记", async () => {
    const list = await noteBlindspot(input({ evidence: "" }), T0);
    expect(list).toEqual([]);
    expect(readLocalBlindspots()).toEqual([]);
  });

  it("setBlindspotStatus 改状态并持久化；改不存在的 id 不炸", async () => {
    const [row] = await noteBlindspot(input(), T0);
    const next = await setBlindspotStatus(row.id, "learning");
    expect(next[0].status).toBe("learning");
    expect(readLocalBlindspots()[0].status).toBe("learning");
    await expect(setBlindspotStatus("bs-不存在", "cleared")).resolves.toHaveLength(1);
  });
});

describe("纠错闭环 · 增强卡草稿标注「用户补充」", () => {
  it("草稿 origin=taught，cautions 末尾带「用户补充 · YYYY-MM-DD」", () => {
    const d = buildCorrectionDraft(
      { wrong: "现存量就是可用量", correct: "算缺口只认可用量那一列", topic: "可用量口径", today: "2026-09-04" },
      "sess-1",
    );
    expect(d.origin).toBe("taught");
    expect(d.enabled).toBe(true);
    expect(d.cautions[d.cautions.length - 1]).toBe("来源：用户补充 · 2026-09-04");
    expect(d.cautions[0]).toContain("算缺口只认可用量那一列");
    expect(d.triggers.length).toBeGreaterThan(0);
  });

  it("她给了触发词就用她的；没给就用主题兜底", () => {
    const withT = buildCorrectionDraft({ wrong: "x", correct: "y", triggers: [" 催货 ", ""], today: "2026-09-04" }, "s");
    expect(withT.triggers).toEqual(["催货"]);
    const without = buildCorrectionDraft({ wrong: "x", correct: "要回签才算答应", topic: "回签才算承诺", today: "2026-09-04" }, "s");
    expect(without.triggers).toEqual(["回签才算承诺"]);
  });

  it("sourceStamp 只接受合法日期，否则用系统日期；sourceLine 前缀固定", () => {
    expect(sourceStamp("2026-09-04")).toBe("2026-09-04");
    expect(sourceStamp("昨天")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(sourceLine("2026-09-04")).toBe("来源：用户补充 · 2026-09-04");
  });
});
