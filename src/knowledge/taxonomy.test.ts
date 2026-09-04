import { describe, expect, it } from "vitest";
import { CATEGORIES } from "./classify";
import {
  RELATIONS,
  RELATION_LABEL,
  REQUIRED_COUNT,
  TOPICS,
  relationsOf,
  topicById,
  topicsByCategory,
  type RelationKind,
} from "./taxonomy";

const ids = new Set(TOPICS.map((t) => t.id));

describe("TOPICS 骨架", () => {
  it("至少 28 条，id 唯一，前缀就是分类", () => {
    expect(TOPICS.length).toBeGreaterThanOrEqual(28);
    expect(ids.size).toBe(TOPICS.length);
    for (const t of TOPICS) expect(t.id.startsWith(`${t.category}.`)).toBe(true);
  });

  it("10 个分类每类至少 2 条，且不出现分类表以外的类", () => {
    const known = new Set(CATEGORIES.map((c) => c.id as string));
    for (const t of TOPICS) expect(known.has(t.category)).toBe(true);
    for (const c of CATEGORIES) expect(topicsByCategory(c.id).length).toBeGreaterThanOrEqual(2);
  });

  it("每条都写了 name / why / askIfMissing，没有占位空串", () => {
    for (const t of TOPICS) {
      expect(t.name.trim().length).toBeGreaterThan(1);
      expect(t.why.trim().length).toBeGreaterThan(10);
      expect(t.askIfMissing.trim().length).toBeGreaterThan(10);
    }
  });

  it("判据可用：关键词非空、无空串、ASCII 词一律小写", () => {
    for (const t of TOPICS) {
      const kws = t.satisfiedBy.keywords;
      expect(kws.length).toBeGreaterThanOrEqual(4);
      expect(new Set(kws).size).toBe(kws.length);
      for (const k of kws) {
        expect(k.trim()).toBe(k);
        expect(k.length).toBeGreaterThan(0);
        if (/^[\x20-\x7e]+$/.test(k)) expect(k).toBe(k.toLowerCase());
      }
      expect(t.satisfiedBy.minChunks ?? 1).toBeGreaterThanOrEqual(1);
    }
  });

  it("REQUIRED_COUNT 与 required 标记一致，且必备是少数派（不能一开机四十条红字）", () => {
    expect(REQUIRED_COUNT).toBe(TOPICS.filter((t) => t.required).length);
    expect(REQUIRED_COUNT).toBeGreaterThanOrEqual(12);
    expect(REQUIRED_COUNT).toBeLessThan(TOPICS.length);
  });

  it("topicById 命中与落空", () => {
    expect(topicById("ordering.available-qty")?.name).toBe("可用量的口径");
    expect(topicById("nope.nope")).toBeUndefined();
  });
});

describe("逻辑关联", () => {
  it("relatedTo 指向真实主题、无自环、无重复", () => {
    for (const t of TOPICS) {
      expect(t.relatedTo).not.toContain(t.id);
      expect(new Set(t.relatedTo).size).toBe(t.relatedTo.length);
      for (const id of t.relatedTo) expect(ids.has(id)).toBe(true);
    }
  });

  it("关联必须双向：A 挂了 B，B 也得挂 A", () => {
    for (const t of TOPICS) {
      for (const id of t.relatedTo) {
        const other = topicById(id)!;
        expect(other.relatedTo).toContain(t.id);
      }
    }
  });

  it("relationKind 与 relatedTo 一一对应，反向类型取反（前置 ↔ 下游）", () => {
    const inverse: Record<RelationKind, RelationKind> = {
      prerequisite: "downstream",
      downstream: "prerequisite",
      contrast: "contrast",
      "same-doc": "same-doc",
    };
    for (const t of TOPICS) {
      expect(Object.keys(t.relationKind).sort()).toEqual([...t.relatedTo].sort());
      for (const id of t.relatedTo) {
        expect(topicById(id)!.relationKind[t.id]).toBe(inverse[t.relationKind[id]]);
      }
    }
  });

  it("四种关系类型都真的用上了，易混对照给足", () => {
    const tally = new Map<RelationKind, number>();
    for (const r of RELATIONS) tally.set(r.kind, (tally.get(r.kind) ?? 0) + 1);
    for (const k of Object.keys(RELATION_LABEL) as RelationKind[]) {
      expect(tally.get(k) ?? 0).toBeGreaterThan(0);
    }
    // contrast 是新人最容易踩的坑，单独设一条硬线
    expect(tally.get("contrast") ?? 0).toBeGreaterThanOrEqual(10);
  });

  it("每条主题至少挂一条关联——挂不上的主题说明骨架没想清楚", () => {
    for (const t of TOPICS) expect(t.relatedTo.length).toBeGreaterThan(0);
  });

  it("relationsOf 把易混对照排在最前面", () => {
    const rs = relationsOf("ordering.pack-round");
    expect(rs.length).toBeGreaterThan(1);
    expect(rs[0].kind).toBe("contrast");
    expect(rs.map((r) => r.topic.id)).toContain("ordering.moq");
    expect(relationsOf("nope.nope")).toEqual([]);
  });

  it("经典易混对：现存量 ↔ 可用量、到货 ↔ 入库、请购单 ↔ 采购订单", () => {
    const pairs: [string, string][] = [
      ["ordering.available-qty", "u8.stock-query"],
      ["inbound.arrival-record", "inbound.receipt-posting"],
      ["ordering.requisition", "u8.po-entry"],
    ];
    for (const [a, b] of pairs) expect(topicById(a)!.relationKind[b]).toBe("contrast");
  });
});
