// 兜底知识的质量守卫。
// 这里挡的不是「代码跑不跑」，是「写出来的东西有没有用」：
// 覆盖率、id 对不对得上、字数够不够、有没有写废话、companyVaries 有没有给出下一步动作。

import { describe, expect, it } from "vitest";
import { coverageWithFallback, FALLBACKS, fallbackFor } from "./fallback";
import { findGaps, gapSummary } from "./gaps";
import { emptyGraph } from "./graph";
import { REQUIRED_COUNT, TOPICS, topicById } from "./taxonomy";
import { TUTORIALS } from "../tutorial/content";
import { SOURCES } from "../tutorial/sources";

const SOURCE_IDS = new Set(SOURCES.map((s) => s.id));
const TUTORIAL_IDS = new Set(TUTORIALS.map((t) => t.id));
const REQUIRED_TOPICS = TOPICS.filter((t) => t.required);

/** 写在兜底里就等于没写的空话 */
const BANNED_WORDS = [
  "重要概念",
  "相关内容",
  "相关知识",
  "相关资料",
  "建议了解",
  "有所了解",
  "非常重要",
  "很重要",
  "不容忽视",
  "加强学习",
  "综上所述",
];

/** 具体动作词：companyVaries 里至少要有一个，否则就是一句「以公司为准」的废话 */
const ACTION_WORDS = ["问", "要", "找", "确认"];

describe("覆盖率", () => {
  it("每一条 required 主题都有兜底（在补齐公司文档之前不能有人是一片空白）", () => {
    const missing = REQUIRED_TOPICS.filter((t) => !fallbackFor(t.id)).map((t) => t.id);
    expect(missing).toEqual([]);
  });

  it("总条数不少于 28 条，非必备里的重要主题也补上了", () => {
    expect(FALLBACKS.length).toBeGreaterThanOrEqual(28);
    expect(FALLBACKS.length).toBeGreaterThan(REQUIRED_COUNT);
  });

  it("没有重复的 topicId", () => {
    expect(new Set(FALLBACKS.map((f) => f.topicId)).size).toBe(FALLBACKS.length);
  });
});

describe("id 必须指得到真东西", () => {
  it("topicId 都存在于 TOPICS", () => {
    for (const f of FALLBACKS) expect(topicById(f.topicId), f.topicId).toBeDefined();
  });

  it("sourceIds 都存在于 SOURCES，且每条至少挂一个出处", () => {
    for (const f of FALLBACKS) {
      expect(f.sourceIds.length, f.topicId).toBeGreaterThan(0);
      for (const id of f.sourceIds) expect(SOURCE_IDS.has(id), `${f.topicId} → ${id}`).toBe(true);
    }
  });

  it("tutorialIds 都存在于 TUTORIALS", () => {
    for (const f of FALLBACKS) {
      for (const id of f.tutorialIds ?? []) expect(TUTORIAL_IDS.has(id), `${f.topicId} → ${id}`).toBe(true);
    }
  });
});

describe("summary 得是人话", () => {
  it("长度在 80~160 字之间", () => {
    for (const f of FALLBACKS) {
      expect(f.summary.length, `${f.topicId} 长度 ${f.summary.length}`).toBeGreaterThanOrEqual(80);
      expect(f.summary.length, `${f.topicId} 长度 ${f.summary.length}`).toBeLessThanOrEqual(160);
    }
  });

  it("全文（含要点和坑）不出现「重要概念」这类废话词", () => {
    for (const f of FALLBACKS) {
      const all = [f.summary, ...f.keyPoints, ...(f.pitfalls ?? []), f.companyVaries].join("\n");
      for (const bad of BANNED_WORDS) expect(all, `${f.topicId} 出现「${bad}」`).not.toContain(bad);
    }
  });
});

describe("keyPoints / pitfalls", () => {
  it("每条 3~5 个要点，且都不是一个词打发", () => {
    for (const f of FALLBACKS) {
      expect(f.keyPoints.length, f.topicId).toBeGreaterThanOrEqual(3);
      expect(f.keyPoints.length, f.topicId).toBeLessThanOrEqual(5);
      for (const k of f.keyPoints) expect(k.trim().length, `${f.topicId}: ${k}`).toBeGreaterThan(10);
    }
  });

  it("pitfalls 写了就不能是空数组、空字符串", () => {
    for (const f of FALLBACKS) {
      if (!f.pitfalls) continue;
      expect(f.pitfalls.length, f.topicId).toBeGreaterThan(0);
      for (const p of f.pitfalls) expect(p.trim().length, `${f.topicId}: ${p}`).toBeGreaterThan(8);
    }
  });
});

describe("companyVaries 是诚实边界，不是免责声明", () => {
  it("非空、够长，并且给出「问 / 要 / 找 / 确认」这样的具体动作", () => {
    for (const f of FALLBACKS) {
      expect(f.companyVaries.trim().length, f.topicId).toBeGreaterThan(20);
      expect(ACTION_WORDS.some((w) => f.companyVaries.includes(w)), `${f.topicId} 没写去问谁`).toBe(true);
    }
  });

  it("needs-company 的条目确实是「细节看公司」那一类，且数量不为零", () => {
    const needs = FALLBACKS.filter((f) => f.confidence === "needs-company");
    expect(needs.length).toBeGreaterThan(0);
    // U8 四条全是账套 / 字段 / 流程配置决定的，一律 needs-company
    for (const f of FALLBACKS.filter((x) => x.topicId.startsWith("u8."))) {
      expect(f.confidence, f.topicId).toBe("needs-company");
    }
  });
});

describe("U8 菜单路径必须标未核对", () => {
  it("凡是写了菜单路径的条目，同一条里必须出现「⚠️ 待实机核对」", () => {
    for (const f of FALLBACKS) {
      const all = [f.summary, ...f.keyPoints, ...(f.pitfalls ?? []), f.companyVaries].join("\n");
      const hasMenuPath = /→/.test(all) && /(供应链|采购管理|库存管理|系统服务|基础档案)/.test(all);
      if (hasMenuPath) expect(all, `${f.topicId} 写了菜单路径却没标注`).toContain("⚠️ 待实机核对");
    }
  });

  it("每条 u8.* 主题都带了未核对标注，不让人以为路径是验过的", () => {
    for (const f of FALLBACKS.filter((x) => x.topicId.startsWith("u8."))) {
      const all = [f.summary, ...f.keyPoints].join("\n");
      expect(all, f.topicId).toContain("⚠️ 待实机核对");
    }
  });
});

describe("coverageWithFallback", () => {
  it("空库：必备缺口全部有兜底，bare 为 0", () => {
    const requiredGaps = findGaps(emptyGraph()).filter((g) => g.topic.required);
    const { withFallback, bare } = coverageWithFallback(requiredGaps);
    expect(withFallback).toBe(REQUIRED_COUNT);
    expect(bare).toBe(0);
  });

  it("认不出的主题算 bare", () => {
    expect(coverageWithFallback([{ topic: { id: "nope.not-a-topic" } }])).toEqual({ withFallback: 0, bare: 1 });
  });
});

describe("findGaps 挂上兜底", () => {
  it("每条必备缺口都带 fallback，且 hasFallback 与之一致", () => {
    for (const g of findGaps(emptyGraph())) {
      expect(g.hasFallback).toBe(g.fallback !== undefined);
      if (g.topic.required) {
        expect(g.fallback, g.topic.id).toBeDefined();
        expect(g.fallback!.topicId).toBe(g.topic.id);
      }
    }
  });
});

describe("gapSummary 的三个数与那句人话", () => {
  it("covered + fallbackOnly + bare = 必备总数", () => {
    const s = gapSummary(emptyGraph());
    expect(s.covered + s.fallbackOnly + s.bare).toBe(s.requiredTotal);
    expect(s.requiredTotal).toBe(REQUIRED_COUNT);
  });

  it("空库时 message 说清「有通用口径顶着」，不摆出一副欠债的口气", () => {
    const s = gapSummary(emptyGraph());
    expect(s.message).toContain(`必备主题 ${REQUIRED_COUNT} 条`);
    expect(s.message).toContain("通用口径");
    expect(s.message).not.toContain("缺失");
    expect(s.bare).toBe(0);
  });
});
