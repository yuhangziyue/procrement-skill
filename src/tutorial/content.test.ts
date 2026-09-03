import { describe, expect, it } from "vitest";
import { OPEN_QUESTIONS, PITFALLS, TUTORIALS, type Confidence } from "./content";
import { groupByCategory, searchTutorials } from "./index";

const RANK: Record<Confidence, number> = { unknown: 0, unverified: 1, verified: 2 };
const VALID_CONFIDENCE: Confidence[] = ["verified", "unverified", "unknown"];
const VALID_CATEGORY = ["query", "export", "import", "flow"];
const VALID_FREQ = ["每天", "每周", "每月", "按需"];

describe("TUTORIALS 基本规模", () => {
  it("至少 10 篇", () => {
    expect(TUTORIALS.length).toBeGreaterThanOrEqual(10);
  });

  it("id 全局唯一", () => {
    const ids = TUTORIALS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
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

  it("category / freq 取值合法", () => {
    for (const t of TUTORIALS) {
      expect(VALID_CATEGORY).toContain(t.category);
      expect(VALID_FREQ).toContain(t.freq);
    }
  });

  it("整篇 confidence = 各步骤里最低的那个", () => {
    for (const t of TUTORIALS) {
      const worstRank = Math.min(...t.steps.map((s) => RANK[s.confidence]));
      const worst = (Object.keys(RANK) as Confidence[]).find((k) => RANK[k] === worstRank);
      expect(t.confidence, `${t.id} 整篇可信度`).toBe(worst);
    }
  });

  it("related 只能指向真实存在的 id", () => {
    const allIds = new Set(TUTORIALS.map((t) => t.id));
    for (const t of TUTORIALS) {
      for (const r of t.related ?? []) {
        expect(allIds.has(r), `${t.id} 的 related 里「${r}」不存在`).toBe(true);
      }
    }
  });

  it("related 不能指向自己", () => {
    for (const t of TUTORIALS) {
      expect(t.related ?? []).not.toContain(t.id);
    }
  });

  it("每篇至少 3 个 checkpoints", () => {
    for (const t of TUTORIALS) {
      expect(t.checkpoints.length, `${t.id} 的 checkpoints`).toBeGreaterThanOrEqual(3);
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

describe("unknown 步骤必须能在 OPEN_QUESTIONS 里找到对应条目", () => {
  // 素材（u8-research.md）里明确标 ❌ 的三件事：采购模块自带的现存量查询、
  // 供应商存货对照表/价格表、库存展望。这三件事在教程里都以 unknown 步骤出现，
  // 也都必须在待核对清单里能查到对应问题。
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

describe("index.ts 查询辅助函数", () => {
  it("groupByCategory 按分类分组且不丢教程", () => {
    const groups = groupByCategory();
    const total = groups.reduce((n, g) => n + g.items.length, 0);
    expect(total).toBe(TUTORIALS.length);
  });

  it("searchTutorials 空关键词返回全部，命中关键词能过滤", () => {
    expect(searchTutorials("").length).toBe(TUTORIALS.length);
    const hit = searchTutorials("执行完未关闭的显示");
    expect(hit.length).toBeGreaterThan(0);
    expect(hit.some((t) => t.id === "po-list")).toBe(true);
  });
});
