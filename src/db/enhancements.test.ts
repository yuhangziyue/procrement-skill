import { describe, expect, it } from "vitest";
import { cardsOverlap, cleanLines, compareEnhancements, findConflicts, triggersOverlap } from "./enhancements";
import type { EnhancementRow } from "./schema";

const card = (p: Partial<EnhancementRow> & { id: string }): EnhancementRow => ({
  name: p.id,
  intents: [],
  triggers: [],
  sop: [],
  cautions: [],
  examples: [],
  enabled: true,
  origin: "user",
  conflictsWith: [],
  createdAt: 0,
  updatedAt: 0,
  ...p,
});

describe("triggersOverlap", () => {
  it("相同 / 互为子串 ⇒ 重叠；大小写与首尾空格不敏感", () => {
    expect(triggersOverlap("催货", "催货")).toBe(true);
    expect(triggersOverlap("催货", "怎么催货")).toBe(true);
    expect(triggersOverlap("怎么催货", "催货")).toBe(true);
    expect(triggersOverlap(" MOQ ", "moq")).toBe(true);
  });
  it("不相干 / 空串 ⇒ 不重叠", () => {
    expect(triggersOverlap("催货", "入库")).toBe(false);
    expect(triggersOverlap("", "入库")).toBe(false);
    expect(triggersOverlap("  ", "")).toBe(false);
  });
});

describe("findConflicts", () => {
  const existing = [
    card({ id: "a", triggers: ["催货", "逾期"] }),
    card({ id: "b", triggers: ["入库单"] }),
    card({ id: "c", triggers: ["催货"], enabled: false }),
    card({ id: "d", triggers: ["到货预告"] }),
  ];

  it("只命中已启用且触发词重叠的卡", () => {
    const r = findConflicts({ triggers: ["怎么催货", "开单"] }, existing);
    expect(r.map((x) => x.id)).toEqual(["a"]);
  });

  it("停用的卡不算冲突", () => {
    const r = findConflicts({ triggers: ["催货"] }, existing.filter((e) => e.id === "c"));
    expect(r).toEqual([]);
  });

  it("编辑场景排除自己", () => {
    const r = findConflicts({ id: "a", triggers: ["催货"] }, existing);
    expect(r.map((x) => x.id)).toEqual([]);
  });

  it("多张重叠全部返回", () => {
    const r = findConflicts({ triggers: ["逾期", "入库"] }, existing);
    expect(r.map((x) => x.id).sort()).toEqual(["a", "b"]);
  });

  it("cardsOverlap 空列表不重叠", () => {
    expect(cardsOverlap([], ["x"])).toBe(false);
  });
});

describe("compareEnhancements", () => {
  it("taught 最前、builtin 最后，组内 updatedAt 倒序", () => {
    const rows = [
      card({ id: "b1", origin: "builtin", updatedAt: 9 }),
      card({ id: "u1", origin: "user", updatedAt: 1 }),
      card({ id: "t1", origin: "taught", updatedAt: 1 }),
      card({ id: "t2", origin: "taught", updatedAt: 5 }),
      card({ id: "u2", origin: "user", updatedAt: 3 }),
    ];
    expect(rows.sort(compareEnhancements).map((r) => r.id)).toEqual(["t2", "t1", "u2", "u1", "b1"]);
  });
});

describe("cleanLines", () => {
  it("去空、trim、去重、保序", () => {
    expect(cleanLines([" a ", "", "b", "a", "  ", "c"])).toEqual(["a", "b", "c"]);
  });
});
