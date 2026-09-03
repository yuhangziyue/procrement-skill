import { describe, expect, it } from "vitest";
import {
  CHAPTERS,
  ITEMS,
  TOTAL_WEEKS,
  TRACKS,
  TUTORIAL_IDS_SNAPSHOT,
  WEEKLY_MINUTES_CAP,
  blockedBy,
  chapterOf,
  itemById,
  nextUp,
  planByWeek,
  readiness,
  type Track,
} from "./plan";

const ids = ITEMS.map((i) => i.id);
const allDone = new Set(ids);

describe("plan · 结构完整性", () => {
  it("条目 id 唯一", () => {
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("条目数 ≥ 40，四条 track 都有条目", () => {
    expect(ITEMS.length).toBeGreaterThanOrEqual(40);
    for (const t of TRACKS) {
      expect(ITEMS.filter((i) => i.track === t.id).length).toBeGreaterThan(0);
    }
  });

  it("每条都有 why / practice / proof / learn，且时长为正", () => {
    for (const i of ITEMS) {
      expect(i.why.length, i.id).toBeGreaterThan(10);
      expect(i.practice.length, i.id).toBeGreaterThan(5);
      expect(i.proof.length, i.id).toBeGreaterThan(5);
      expect(i.learn.length, i.id).toBeGreaterThan(0);
      expect(i.minutes, i.id).toBeGreaterThan(0);
    }
  });

  it("周次落在 1..16 之内，且 16 周每周都排了东西", () => {
    for (const i of ITEMS) {
      expect(i.week, i.id).toBeGreaterThanOrEqual(1);
      expect(i.week, i.id).toBeLessThanOrEqual(TOTAL_WEEKS);
    }
    const weeks = new Set(ITEMS.map((i) => i.week));
    for (let w = 1; w <= TOTAL_WEEKS; w++) expect(weeks.has(w), `第 ${w} 周是空的`).toBe(true);
  });
});

describe("plan · deps 是一张真的有向无环图", () => {
  it("deps 指向的 id 都存在，且不自指", () => {
    for (const i of ITEMS) {
      for (const d of i.deps ?? []) {
        expect(itemById(d), `${i.id} 的前置 ${d} 不存在`).toBeDefined();
        expect(d).not.toBe(i.id);
      }
    }
  });

  it("deps 无环（Kahn 拓扑排序能排完全部节点）", () => {
    const indeg = new Map<string, number>(ITEMS.map((i) => [i.id, (i.deps ?? []).length]));
    // 反向边：dep -> 依赖它的那些条目
    const out = new Map<string, string[]>();
    for (const i of ITEMS) {
      for (const d of i.deps ?? []) out.set(d, [...(out.get(d) ?? []), i.id]);
    }
    const queue = ids.filter((id) => (indeg.get(id) ?? 0) === 0);
    const order: string[] = [];
    while (queue.length) {
      const cur = queue.shift()!;
      order.push(cur);
      for (const nxt of out.get(cur) ?? []) {
        const left = (indeg.get(nxt) ?? 0) - 1;
        indeg.set(nxt, left);
        if (left === 0) queue.push(nxt);
      }
    }
    const stuck = ids.filter((id) => !order.includes(id));
    expect(stuck, `这些条目卡在环里：${stuck.join(", ")}`).toEqual([]);
    expect(order.length).toBe(ITEMS.length);
  });

  it("前置条目不排在本条之后（学的时候不会遇到还没学的前置）", () => {
    for (const i of ITEMS) {
      for (const d of i.deps ?? []) {
        expect(itemById(d)!.week, `${i.id}(第${i.week}周) 依赖 ${d}`).toBeLessThanOrEqual(i.week);
      }
    }
  });
});

describe("plan · 每周不许排满", () => {
  it("每周总时长 ≤ 90 分钟", () => {
    for (const w of planByWeek()) {
      expect(w.totalMinutes, `第 ${w.week} 周排了 ${w.totalMinutes} 分钟`).toBeLessThanOrEqual(WEEKLY_MINUTES_CAP);
    }
  });

  it("planByWeek 返回 16 周、覆盖全部条目、totalMinutes 与条目相加一致", () => {
    const weeks = planByWeek();
    expect(weeks.map((w) => w.week)).toEqual(Array.from({ length: TOTAL_WEEKS }, (_, k) => k + 1));
    expect(weeks.flatMap((w) => w.items.map((i) => i.id)).sort()).toEqual([...ids].sort());
    for (const w of weeks) {
      expect(w.totalMinutes).toBe(w.items.reduce((s, i) => s + i.minutes, 0));
      expect(w.theme.length).toBeGreaterThan(0);
    }
  });
});

describe("plan · 前五条是采姐点名的五个命门", () => {
  it("顺序与主题都对得上：可用量≠现存量 / 有效在途 / 生产周期口径 / MOQ vs 凑整 / 含税不含税", () => {
    const first5 = ITEMS.slice(0, 5);
    expect(first5.map((i) => i.id)).toEqual([
      "B1-available-qty",
      "B2-effective-intransit",
      "B3-lead-time-calendar",
      "B4-moq-vs-pack",
      "B5-tax-basis",
    ]);
    const keywords = ["可用量", "有效在途", "生产周期", "MOQ", "含税"];
    first5.forEach((i, k) => expect(i.title, i.id).toContain(keywords[k]));
    // 命门要排在头两周，不能拖
    for (const i of first5) expect(i.week).toBeLessThanOrEqual(2);
  });
});

describe("plan · 章节", () => {
  it("每个条目恰好属于一个章节，且章节里的 id 都存在、track 一致", () => {
    const seen = new Map<string, number>();
    for (const c of CHAPTERS) {
      expect(c.goal.length).toBeGreaterThan(0);
      for (const id of c.items) {
        const item = itemById(id);
        expect(item, `章节 ${c.id} 里的 ${id} 不存在`).toBeDefined();
        expect(item!.track, `${id} 的 track 与章节 ${c.id} 不一致`).toBe(c.track);
        seen.set(id, (seen.get(id) ?? 0) + 1);
      }
    }
    for (const id of ids) expect(seen.get(id), `${id} 没有归入任何章节`).toBe(1);
    expect(chapterOf("B1-available-qty")?.track).toBe("basics");
  });
});

describe("plan · refs", () => {
  it("tutorial 类 ref 的 id 都在教程模块的 id 快照里（接入时由老架跟真实模块再校验一次）", () => {
    const known = new Set<string>(TUTORIAL_IDS_SNAPSHOT);
    const tutorialIds = ITEMS.flatMap((i) => i.refs ?? [])
      .filter((r) => r.kind === "tutorial")
      .map((r) => r.id);
    expect(tutorialIds.length).toBeGreaterThan(5);
    for (const id of tutorialIds) expect(known.has(id), `教程里没有 ${id}`).toBe(true);
  });

  it("每条 ref 都有 label，且系统操作赛道至少有一半条目挂了教程", () => {
    for (const i of ITEMS) for (const r of i.refs ?? []) expect(r.label.length, `${i.id}/${r.id}`).toBeGreaterThan(0);
    const sys = ITEMS.filter((i) => i.track === "system");
    const withTutorial = sys.filter((i) => (i.refs ?? []).some((r) => r.kind === "tutorial"));
    expect(withTutorial.length * 2).toBeGreaterThanOrEqual(sys.length);
  });
});

describe("nextUp", () => {
  it("一次最多 3 条（默认），且都是没完成的", () => {
    const r = nextUp(new Set());
    expect(r.length).toBeLessThanOrEqual(3);
    expect(r.length).toBeGreaterThan(0);
    for (const i of r) expect(i.week).toBeLessThanOrEqual(2);
  });

  it("不返回前置未完成的条目", () => {
    const done = new Set<string>();
    for (const i of nextUp(done, 99)) {
      expect(i.deps ?? [], `${i.id} 的前置还没完成`).toEqual([]);
    }
    // S1 依赖 B1，B1 没做时不该出现
    expect(nextUp(done, 99).map((i) => i.id)).not.toContain("S1-stock-query");
  });

  it("前置完成后，该条目才进入推荐池", () => {
    const done = new Set(["B1-available-qty"]);
    expect(nextUp(done, 99).map((i) => i.id)).toContain("S1-stock-query");
  });

  it("已完成的不再推荐；limit 生效；全部完成时返回空", () => {
    const done = new Set(["B1-available-qty", "B2-effective-intransit"]);
    const r = nextUp(done, 99);
    expect(r.map((i) => i.id)).not.toContain("B1-available-qty");
    expect(nextUp(done, 1).length).toBe(1);
    expect(nextUp(allDone)).toEqual([]);
  });

  it("按周次排序：靠前周的条目优先出现", () => {
    const r = nextUp(new Set(), 10);
    const weeks = r.map((i) => i.week);
    expect([...weeks].sort((a, b) => a - b)).toEqual(weeks);
  });
});

describe("readiness", () => {
  it("四条 track 各一行，total 与条目数一致，未完成时 done=0", () => {
    const r = readiness(new Set());
    expect(r.map((x) => x.track)).toEqual(TRACKS.map((t) => t.id) as Track[]);
    for (const row of r) {
      expect(row.total).toBe(ITEMS.filter((i) => i.track === row.track).length);
      expect(row.done).toBe(0);
      expect(row.gaps.length).toBeGreaterThan(0);
      expect(row.gaps.length).toBeLessThanOrEqual(3);
    }
  });

  it("完成若干条后 done 计数正确，gaps 里不含已完成的标题", () => {
    const done = new Set(["B1-available-qty", "B2-effective-intransit", "S1-stock-query"]);
    const r = readiness(done);
    const basics = r.find((x) => x.track === "basics")!;
    const system = r.find((x) => x.track === "system")!;
    expect(basics.done).toBe(2);
    expect(system.done).toBe(1);
    expect(basics.gaps).not.toContain(itemById("B1-available-qty")!.title);
    expect(basics.gaps[0]).toBe(itemById("B3-lead-time-calendar")!.title);
  });

  it("全部完成时 done=total 且 gaps 为空", () => {
    for (const row of readiness(allDone)) {
      expect(row.done).toBe(row.total);
      expect(row.gaps).toEqual([]);
    }
  });
});

describe("blockedBy", () => {
  it("列出还没完成的前置（用于锁形提示，不硬拦）", () => {
    const s1 = itemById("S1-stock-query")!;
    expect(blockedBy(s1, new Set()).map((i) => i.id)).toEqual(["B1-available-qty"]);
    expect(blockedBy(s1, new Set(["B1-available-qty"]))).toEqual([]);
    expect(blockedBy(itemById("B1-available-qty")!, new Set())).toEqual([]);
  });
});
