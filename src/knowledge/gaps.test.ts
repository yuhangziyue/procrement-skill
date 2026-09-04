import { describe, expect, it } from "vitest";
import { BANNED_PHRASES, findGaps, gapSummary, gapsByCategory, topGaps } from "./gaps";
import { buildGraph, emptyGraph, type GraphChunk } from "./graph";
import { REQUIRED_COUNT, TOPICS, topicById } from "./taxonomy";

const chunk = (id: string, text: string, heading = ""): GraphChunk => ({ id, docId: "d1", heading, text });
const docs = [{ id: "d1", title: "临时导入的一份文档" }];

describe("findGaps 分级", () => {
  it("空库：必备主题全部是 must，数量正好是 REQUIRED_COUNT", () => {
    const gaps = findGaps(emptyGraph());
    expect(gaps).toHaveLength(TOPICS.length);
    expect(gaps.filter((g) => g.severity === "must")).toHaveLength(REQUIRED_COUNT);
  });

  it("非必备主题缺失只算 should，不报警", () => {
    const gaps = findGaps(emptyGraph());
    for (const g of gaps) {
      if (!g.topic.required) expect(g.severity).toBe("should");
    }
    expect(gaps.some((g) => g.severity === "should")).toBe(true);
  });

  it("必备但只写了一半（hits > 0 却不到 minChunks）降级成 should，并把差距说清楚", () => {
    const g = buildGraph(docs, [chunk("c1", "先算毛需求，再看净需求。")]);
    const gap = findGaps(g).find((x) => x.topic.id === "ordering.net-shortage")!;
    expect(gap.severity).toBe("should");
    expect(gap.hits).toBe(1);
    expect(gap.need).toBe(2);
    expect(gap.ask).toContain("只有 1 段");
    expect(gap.ask).toContain(topicById("ordering.net-shortage")!.askIfMissing);
  });

  it("已达标的主题不出现在缺口里", () => {
    const g = buildGraph(docs, [chunk("c1", "严禁收受回扣，廉洁红线不能碰。")]);
    expect(findGaps(g).map((x) => x.topic.id)).not.toContain("policy.integrity");
  });

  it("must 全排在 should 前面", () => {
    const gaps = findGaps(emptyGraph());
    const lastMust = gaps.map((g) => g.severity).lastIndexOf("must");
    const firstShould = gaps.map((g) => g.severity).indexOf("should");
    expect(lastMust).toBeLessThan(firstShould);
  });

  it("alsoCovers 只列「同一份文件」且同样没达标的主题", () => {
    const gaps = findGaps(emptyGraph());
    const g = gaps.find((x) => x.topic.id === "policy.record-keeping")!;
    const names = g.alsoCovers.map((t) => t.id);
    expect(names).toContain("policy.approval-matrix");
    for (const id of names) expect(topicById("policy.record-keeping")!.relationKind[id]).toBe("same-doc");
  });
});

describe("ask 必须是人话", () => {
  it("每条都非空、够长、不含「建议补充相关资料」这类空话", () => {
    for (const g of findGaps(emptyGraph())) {
      expect(g.ask.trim().length).toBeGreaterThan(20);
      for (const bad of BANNED_PHRASES) expect(g.ask).not.toContain(bad);
    }
  });

  it("必备缺口要说清现状，再给一个能马上做的动作（找谁 / 要什么 / 怎么记）", () => {
    const actors = ["找", "问", "让", "跟", "供应商", "仓管", "管理员", "部", "自己"];
    const actions = ["要一份", "要「", "要《", "导进来", "记下来", "列出来", "整理", "截", "确认", "存成", "写成", "列一张"];
    for (const g of findGaps(emptyGraph()).filter((x) => x.severity === "must")) {
      expect(g.ask).toContain("——"); // 前半句说缺什么，后半句说去做什么
      expect(actors.some((w) => g.ask.includes(w))).toBe(true);
      expect(actions.some((w) => g.ask.includes(w))).toBe(true);
    }
  });
});

describe("topGaps / gapSummary / gapsByCategory", () => {
  it("topGaps 默认取 3 条，空库时全是 must", () => {
    const top = topGaps(emptyGraph());
    expect(top).toHaveLength(3);
    expect(top.every((g) => g.severity === "must")).toBe(true);
    expect(topGaps(emptyGraph(), 0)).toEqual([]);
  });

  it("gapSummary 的进度句：空库报还差多少，全齐时换一句", () => {
    const s = gapSummary(emptyGraph());
    expect(s.requiredSatisfied).toBe(0);
    expect(s.requiredTotal).toBe(REQUIRED_COUNT);
    expect(s.mustCount).toBe(REQUIRED_COUNT);
    expect(s.headline).toContain(`0/${REQUIRED_COUNT}`);
    expect(s.headline).toContain("还差");
  });

  it("gapsByCategory 按分类汇总，带中文分类名", () => {
    const m = gapsByCategory(emptyGraph());
    expect(m.get("inbound")!.label).toBe("到货与入库");
    expect(m.get("inbound")!.must).toBeGreaterThan(0);
    const total = [...m.values()].reduce((n, v) => n + v.must + v.should, 0);
    expect(total).toBe(TOPICS.length);
  });
});
