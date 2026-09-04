import { describe, expect, it } from "vitest";
import { OPEN_QUESTIONS, PITFALLS, TUTORIALS, type Confidence, type Stage } from "./content";
import { SOURCES, SOURCE_COVER_IDS, type SourceKind } from "./sources";
import {
  STAGE_ORDER,
  groupByStage,
  groupSourcesByKind,
  resolveTutorials,
  searchSources,
  searchTutorials,
} from "./index";

const RANK: Record<Confidence, number> = { unknown: 0, unverified: 1, verified: 2 };
const VALID_CONFIDENCE: Confidence[] = ["verified", "unverified", "unknown"];
const VALID_STAGE: Stage[] = ["plan", "order", "confirm", "track", "receive", "settle", "basics"];
const VALID_FREQ = ["每天", "每周", "每月", "按需"];
const VALID_KIND: SourceKind[] = ["book", "standard", "course", "video", "site"];

/** 纯业务常识篇：不依赖 U8 菜单，任何一步都不许出现 where。 */
const BIZ_IDS = [
  "qty-basics",
  "net-requirement",
  "po-essentials",
  "confirm-signback",
  "order-change",
  "chase-playbook",
  "receive-checklist",
  "settle-reconcile",
];

const ALL_IDS = new Set(TUTORIALS.map((t) => t.id));

describe("TUTORIALS 基本规模", () => {
  it("重组后至少 20 篇（原 13 篇 + 业务常识篇）", () => {
    expect(TUTORIALS.length).toBeGreaterThanOrEqual(20);
  });

  it("id 全局唯一", () => {
    const ids = TUTORIALS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("原有 13 篇一篇都没丢", () => {
    for (const id of [
      "po-query", "po-list", "po-exec-stat", "stock-query", "in-transit-scopes", "po-instock-query",
      "export-excel", "import-standard", "import-archive", "import-no-permission",
      "flow-standard", "flow-return", "flow-provision",
    ]) {
      expect(ALL_IDS.has(id), `原有教程 ${id} 不见了`).toBe(true);
    }
  });
});

describe("按业务流程分组：stage", () => {
  it("stage / freq 取值合法", () => {
    for (const t of TUTORIALS) {
      expect(VALID_STAGE, `${t.id} 的 stage`).toContain(t.stage);
      expect(VALID_FREQ, `${t.id} 的 freq`).toContain(t.freq);
    }
  });

  it("七个阶段每一组都至少有一篇——没有空着的阶段", () => {
    for (const stage of STAGE_ORDER) {
      const n = TUTORIALS.filter((t) => t.stage === stage).length;
      expect(n, `阶段 ${stage} 一篇教程都没有`).toBeGreaterThan(0);
    }
  });

  it("TUTORIALS 的排列顺序就是采购闭环的顺序（同一阶段的篇连在一起）", () => {
    const seen: Stage[] = [];
    for (const t of TUTORIALS) {
      if (seen[seen.length - 1] !== t.stage) seen.push(t.stage);
    }
    expect(new Set(seen).size, "同一个 stage 在数组里被拆散了").toBe(seen.length);
    const order = seen.map((s) => STAGE_ORDER.indexOf(s));
    expect(order, "阶段出现顺序和 STAGE_ORDER 不一致").toEqual([...order].sort((a, b) => a - b));
  });

  it("groupByStage 按阶段分组且不丢教程", () => {
    const groups = groupByStage();
    expect(groups.reduce((n, g) => n + g.items.length, 0)).toBe(TUTORIALS.length);
    for (const g of groups) {
      expect(g.hint.trim().length, `${g.stage} 缺「什么时候看这组」的提示`).toBeGreaterThan(0);
    }
  });
});

describe("prereq / nextUp：教程之间是一条路径，不是孤岛", () => {
  it("prereq / nextUp 只能指向真实存在的 id，且不能指向自己", () => {
    for (const t of TUTORIALS) {
      for (const id of [...(t.prereq ?? []), ...(t.nextUp ?? [])]) {
        expect(ALL_IDS.has(id), `${t.id} 指向了不存在的 ${id}`).toBe(true);
        expect(id, `${t.id} 指向了自己`).not.toBe(t.id);
      }
    }
  });

  it("prereq / nextUp 构成的有向图无环（否则学习路径会绕死）", () => {
    // 边的方向统一成「先 → 后」：a.nextUp 里的 b 是 a→b；a.prereq 里的 p 是 p→a。
    const edges = new Map<string, Set<string>>();
    const push = (from: string, to: string) => {
      if (!edges.has(from)) edges.set(from, new Set());
      edges.get(from)!.add(to);
    };
    for (const t of TUTORIALS) {
      for (const n of t.nextUp ?? []) push(t.id, n);
      for (const p of t.prereq ?? []) push(p, t.id);
    }
    const state = new Map<string, 0 | 1 | 2>(); // 0 未访问 1 在栈上 2 完成
    const path: string[] = [];
    const walk = (id: string): string[] | null => {
      if (state.get(id) === 1) return [...path, id];
      if (state.get(id) === 2) return null;
      state.set(id, 1);
      path.push(id);
      for (const next of edges.get(id) ?? []) {
        const cycle = walk(next);
        if (cycle) return cycle;
      }
      path.pop();
      state.set(id, 2);
      return null;
    };
    for (const t of TUTORIALS) {
      const cycle = walk(t.id);
      expect(cycle, `发现环：${cycle?.join(" → ")}`).toBeNull();
    }
  });

  it("至少一半的教程有 prereq 或 nextUp —— 不能只挂两条意思一下", () => {
    const linked = TUTORIALS.filter((t) => (t.prereq?.length ?? 0) + (t.nextUp?.length ?? 0) > 0);
    expect(linked.length).toBeGreaterThanOrEqual(Math.ceil(TUTORIALS.length / 2));
  });

  it("resolveTutorials 能把 id 串解析成教程，undefined 返回空数组", () => {
    expect(resolveTutorials(undefined)).toEqual([]);
    const t = TUTORIALS.find((x) => (x.nextUp?.length ?? 0) > 0)!;
    expect(resolveTutorials(t.nextUp).length).toBe(t.nextUp!.length);
  });
});

describe("每篇教程的结构合法性", () => {
  it("steps 序号从 1 开始连续递增", () => {
    for (const t of TUTORIALS) {
      const ns = t.steps.map((s) => s.n);
      expect(ns, `${t.id} 的步骤序号`).toEqual(ns.map((_, i) => i + 1));
    }
  });

  it("confidence 取值合法（三选一），steps 里也一样", () => {
    for (const t of TUTORIALS) {
      expect(VALID_CONFIDENCE).toContain(t.confidence);
      for (const s of t.steps) {
        expect(VALID_CONFIDENCE, `${t.id} 步骤「${s.title}」`).toContain(s.confidence);
      }
    }
  });

  it("整篇 confidence = 各步骤里最低的那个", () => {
    for (const t of TUTORIALS) {
      const worstRank = Math.min(...t.steps.map((s) => RANK[s.confidence]));
      const worst = (Object.keys(RANK) as Confidence[]).find((k) => RANK[k] === worstRank);
      expect(t.confidence, `${t.id} 整篇可信度`).toBe(worst);
    }
  });

  it("每篇的 scene / goal 都非空，且 scene 写成了一句真实处境而不是三五个字的功能名", () => {
    for (const t of TUTORIALS) {
      expect(t.scene.trim().length, `${t.id} 的 scene 太短或为空`).toBeGreaterThanOrEqual(15);
      expect(t.goal.trim().length, `${t.id} 的 goal 太短或为空`).toBeGreaterThanOrEqual(15);
    }
  });

  it("related 只能指向真实存在的 id，且不能指向自己", () => {
    for (const t of TUTORIALS) {
      for (const r of t.related ?? []) {
        expect(ALL_IDS.has(r), `${t.id} 的 related 里「${r}」不存在`).toBe(true);
        expect(r).not.toBe(t.id);
      }
    }
  });

  it("每篇至少 3 个 checkpoints、至少 1 步操作", () => {
    for (const t of TUTORIALS) {
      expect(t.checkpoints.length, `${t.id} 的 checkpoints`).toBeGreaterThanOrEqual(3);
      expect(t.steps.length, `${t.id} 的 steps`).toBeGreaterThanOrEqual(1);
    }
  });

  it("troubleshooting 每条都有完整的 symptom/cause/fix", () => {
    for (const t of TUTORIALS) {
      for (const item of t.troubleshooting) {
        expect(item.symptom.trim().length, `${t.id}`).toBeGreaterThan(0);
        expect(item.cause.trim().length, `${t.id}`).toBeGreaterThan(0);
        expect(item.fix.trim().length, `${t.id}`).toBeGreaterThan(0);
      }
    }
  });

  it("标 unknown（❌）的步骤绝不能带 where —— 不许编路径", () => {
    for (const t of TUTORIALS) {
      for (const s of t.steps) {
        if (s.confidence === "unknown") {
          expect(s.where, `${t.id} 步骤「${s.title}」标了 unknown 却带了 where`).toBeUndefined();
        }
      }
    }
  });
});

describe("业务常识篇（不依赖 U8 界面）", () => {
  it("三类必须有的业务常识篇都在：可用量三个数 / 订单必写要素 / 催货升级路径", () => {
    for (const id of ["qty-basics", "po-essentials", "chase-playbook"]) {
      expect(ALL_IDS.has(id), `缺业务常识篇 ${id}`).toBe(true);
    }
    expect(BIZ_IDS.every((id) => ALL_IDS.has(id))).toBe(true);
    expect(BIZ_IDS.length).toBeGreaterThanOrEqual(3);
  });

  it("业务常识篇任何一步都不带 U8 菜单路径 —— 它们讲的是业务，不是界面", () => {
    for (const id of BIZ_IDS) {
      const t = TUTORIALS.find((x) => x.id === id)!;
      for (const s of t.steps) {
        expect(s.where, `${id} 的步骤「${s.title}」不该带菜单路径`).toBeUndefined();
      }
    }
  });
});

describe("unknown 步骤必须能在 OPEN_QUESTIONS 里找到对应条目", () => {
  // 素材（u8-research.md）里明确标 ❌ 的三件事：采购模块自带的现存量查询、
  // 供应商存货对照表/价格表、库存展望。重组只是换了分组，这三处标注一条没动。
  const expectedMap: Record<string, string> = {
    "stock-query": "oq-purchase-stock-view",
    "po-query": "oq-supplier-material-map",
    "in-transit-scopes": "oq-stock-outlook",
  };

  it("三处已知的 unknown 步骤都能在 OPEN_QUESTIONS 里对上号", () => {
    const oqIds = new Set(OPEN_QUESTIONS.map((q) => q.id));
    for (const [tutorialId, oqId] of Object.entries(expectedMap)) {
      const t = TUTORIALS.find((x) => x.id === tutorialId)!;
      expect(t, `找不到教程 ${tutorialId}`).toBeTruthy();
      expect(t.steps.some((s) => s.confidence === "unknown"), `${tutorialId} 应该有一个 unknown 步骤`).toBe(true);
      expect(oqIds.has(oqId), `OPEN_QUESTIONS 里缺 ${oqId}`).toBe(true);
    }
  });

  it("全部 unknown 步骤的数量不超过 OPEN_QUESTIONS 条数（每条 unknown 都该有人管）", () => {
    const unknownStepCount = TUTORIALS.reduce(
      (n, t) => n + t.steps.filter((s) => s.confidence === "unknown").length,
      0,
    );
    expect(unknownStepCount).toBeGreaterThan(0);
    expect(OPEN_QUESTIONS.length).toBeGreaterThanOrEqual(unknownStepCount);
  });
});

describe("PITFALLS", () => {
  it("14 条坑一条不落", () => {
    expect(PITFALLS.length).toBe(14);
  });

  it("id 唯一，字段齐全", () => {
    const ids = PITFALLS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of PITFALLS) {
      expect(p.title.trim().length).toBeGreaterThan(0);
      expect(p.detail.trim().length).toBeGreaterThan(0);
      expect(p.source.trim().length).toBeGreaterThan(0);
    }
  });

  it("覆盖了几条关键坑（原文原样带进来，不是重新编的）", () => {
    const joined = PITFALLS.map((p) => p.title + p.detail).join("\n");
    expect(joined).toContain("执行完未关闭的显示");
    expect(joined).toContain("采购订单执行统计表");
    expect(joined).toContain("到货单不填仓库");
  });
});

describe("OPEN_QUESTIONS", () => {
  it("11 项待核清单一项不落", () => {
    expect(OPEN_QUESTIONS.length).toBe(11);
  });

  it("id 唯一，howToVerify 都写清了打开哪个菜单/截什么图", () => {
    const ids = OPEN_QUESTIONS.map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const q of OPEN_QUESTIONS) {
      expect(q.question.trim().length).toBeGreaterThan(0);
      expect(q.why.trim().length).toBeGreaterThan(0);
      expect(q.howToVerify.trim().length).toBeGreaterThan(0);
    }
  });
});

describe("SOURCES 权威信源库", () => {
  it("至少 14 条，id 全局唯一", () => {
    expect(SOURCES.length).toBeGreaterThanOrEqual(14);
    const ids = SOURCES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("kind / level / lang / confidence 取值合法", () => {
    for (const s of SOURCES) {
      expect(VALID_KIND, `${s.id} 的 kind`).toContain(s.kind);
      expect(["入门", "进阶", "参考"], `${s.id} 的 level`).toContain(s.level);
      expect(["zh", "en"], `${s.id} 的 lang`).toContain(s.lang);
      expect(["verified", "unverified"], `${s.id} 的 confidence`).toContain(s.confidence);
    }
  });

  it("书籍 / 标准 / 认证课程 / 视频公开课 四类都有，不是清一色的书单", () => {
    for (const kind of ["book", "standard", "course", "video"] as SourceKind[]) {
      expect(SOURCES.some((s) => s.kind === kind), `信源里没有 ${kind} 这一类`).toBe(true);
    }
  });

  it("covers 非空，且只能用知识库那 10 类分类", () => {
    for (const s of SOURCES) {
      expect(s.covers.length, `${s.id} 的 covers 为空`).toBeGreaterThan(0);
      for (const c of s.covers) {
        expect(SOURCE_COVER_IDS as readonly string[], `${s.id} 用了非法分类 ${c}`).toContain(c);
      }
    }
  });

  it("每条都有 why，且写的是「对新人有什么用」不是一句书名重复", () => {
    for (const s of SOURCES) {
      expect(s.why.trim().length, `${s.id} 的 why 太短`).toBeGreaterThanOrEqual(15);
      expect(s.why.trim(), `${s.id} 的 why 只是把标题抄了一遍`).not.toBe(s.title.trim());
    }
  });

  it("红线：unverified 的一律不带 isbn（查不到就不许编）", () => {
    for (const s of SOURCES.filter((x) => x.confidence === "unverified")) {
      expect(s.isbn, `${s.id} 标了 unverified 却带着 ISBN`).toBeUndefined();
    }
  });

  it("verified 的必须留下可复核的出处：ISBN、标准号或 URL 至少有一样", () => {
    for (const s of SOURCES.filter((x) => x.confidence === "verified")) {
      const hasProof = !!s.isbn || !!s.url || /GB\/T|ISO|民法典/.test(s.title);
      expect(hasProof, `${s.id} 标了 verified 却拿不出任何出处`).toBe(true);
    }
  });

  it("ISBN 只能是 13 位数字（10 位老 ISBN 和带横杠的一律不收）", () => {
    for (const s of SOURCES) {
      if (s.isbn) expect(s.isbn, `${s.id} 的 ISBN 格式不对`).toMatch(/^\d{13}$/);
    }
  });

  it("groupSourcesByKind 不丢条目，searchSources 空关键词返回全部、命中能过滤", () => {
    const groups = groupSourcesByKind();
    expect(groups.reduce((n, g) => n + g.items.length, 0)).toBe(SOURCES.length);
    expect(searchSources("").length).toBe(SOURCES.length);
    const hit = searchSources("刘宝红");
    expect(hit.length).toBeGreaterThan(0);
    expect(hit.every((s) => (s.author ?? "").includes("刘宝红"))).toBe(true);
  });
});

describe("index.ts 查询辅助函数", () => {
  it("searchTutorials 空关键词返回全部，命中关键词能过滤", () => {
    expect(searchTutorials("").length).toBe(TUTORIALS.length);
    const hit = searchTutorials("执行完未关闭的显示");
    expect(hit.length).toBeGreaterThan(0);
    expect(hit.some((t) => t.id === "po-list")).toBe(true);
  });

  it("搜业务常识里的说法也能命中（比如「有效在途」）", () => {
    const hit = searchTutorials("有效在途");
    expect(hit.some((t) => t.id === "qty-basics")).toBe(true);
  });
});
