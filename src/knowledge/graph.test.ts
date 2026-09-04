import { describe, expect, it } from "vitest";
import {
  buildGraph,
  coverageOf,
  docsForTopic,
  emptyGraph,
  matchTopics,
  relatedTopics,
  topicIdsForText,
  type GraphChunk,
  type GraphDoc,
} from "./graph";
import { RELATIONS, REQUIRED_COUNT, TOPICS, topicById } from "./taxonomy";

const doc = (id: string, title: string): GraphDoc => ({ id, title });
const chunk = (id: string, docId: string, text: string, heading = ""): GraphChunk => ({ id, docId, heading, text });

const covered = (g: ReturnType<typeof buildGraph>, id: string) => !!coverageOf(g, id)?.satisfied;

describe("matchTopics 命中判定", () => {
  it("讲可用量的一段能挂到「可用量的口径」上", () => {
    const hit = matchTopics("下单前先看可用量，可用量 = 现存量减去已分配的部分。");
    expect(hit.map((h) => h.topic.id)).toContain("ordering.available-qty");
  });

  it("标题也参与匹配：正文没提词、标题提了也算", () => {
    const ids = topicIdsForText("这一步一定要先跟仓管确认。", "采购制度 > 来料检验规范");
    expect(ids).toContain("inbound.acceptance");
  });

  it("ASCII 关键词加了边界，moqx 不算 MOQ、u80 不算 U8", () => {
    expect(topicIdsForText("这个参数叫 moqx，是内部代号。")).not.toContain("ordering.moq");
    expect(topicIdsForText("型号 u80 的机器。")).not.toContain("u8.login-account");
    expect(topicIdsForText("这家的 MOQ 是 500 只。")).toContain("ordering.moq");
  });

  it("完全无关的闲聊一条都挂不上", () => {
    expect(topicIdsForText("今天中午食堂的红烧肉卖完了。")).toEqual([]);
  });
});

describe("buildGraph 覆盖与达标线", () => {
  it("空库：一条都不算覆盖，必备总数对得上 REQUIRED_COUNT", () => {
    const g = emptyGraph();
    expect(g.total).toBe(TOPICS.length);
    expect(g.satisfied).toBe(0);
    expect(g.requiredTotal).toBe(REQUIRED_COUNT);
    expect(g.requiredSatisfied).toBe(0);
  });

  it("一段就够的主题：一条切片即达标，并记下文档与切片 id", () => {
    const g = buildGraph(
      [doc("d1", "采购基础问答")],
      [chunk("c1", "d1", "可用量要减掉已分配的量，别拿现存量直接下单。")],
    );
    const cov = coverageOf(g, "ordering.available-qty")!;
    expect(cov.satisfied).toBe(true);
    expect(cov.hits).toBe(1);
    expect(cov.docIds).toEqual(["d1"]);
    expect(cov.chunkIds).toEqual(["c1"]);
    expect(cov.matches[0].keywords).toContain("可用量");
  });

  it("minChunks = 2 的主题：只写一段不算数，两段才达标", () => {
    const topic = topicById("ordering.net-shortage")!;
    expect(topic.satisfiedBy.minChunks).toBe(2);
    const one = buildGraph([doc("d1", "缺料")], [chunk("c1", "d1", "先算毛需求，再看净需求。")]);
    expect(covered(one, "ordering.net-shortage")).toBe(false);
    expect(coverageOf(one, "ordering.net-shortage")!.hits).toBe(1);

    const two = buildGraph(
      [doc("d1", "缺料")],
      [
        chunk("c1", "d1", "先算毛需求，再看净需求。"),
        chunk("c2", "d1", "缺口数量 = 需求减库存，再扣掉安全库存。"),
      ],
    );
    expect(covered(two, "ordering.net-shortage")).toBe(true);
  });

  it("同一份文档的多段命中会合并到一条主题下，docIds 去重", () => {
    const g = buildGraph(
      [doc("d1", "入库 SOP")],
      [
        chunk("c1", "d1", "采购入库单要在质检合格后再做。", "入库"),
        chunk("c2", "d1", "入库单过账以后库存和应付同时变动。", "入库 > 过账"),
      ],
    );
    const cov = coverageOf(g, "inbound.receipt-posting")!;
    expect(cov.hits).toBe(2);
    expect(cov.docIds).toEqual(["d1"]);
    expect(cov.satisfied).toBe(true);
  });

  it("docsForTopic 给出文档标题 + 切片 id + 摘录，能顺着点到那一段", () => {
    const g = buildGraph(
      [doc("d7", "廉洁承诺书")],
      [chunk("c9", "d7", "严禁收受供应商回扣，触碰廉洁红线一律解除劳动合同。", "行为准则")],
    );
    const rows = docsForTopic("policy.integrity", g);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ docId: "d7", title: "廉洁承诺书", chunkId: "c9" });
    expect(rows[0].excerpt).toContain("回扣");
    expect(docsForTopic("nope.nope", g)).toEqual([]);
  });
});

describe("edges 关联边", () => {
  it("边数等于声明数，端点都存在、无自环", () => {
    const g = emptyGraph();
    expect(g.edges).toHaveLength(RELATIONS.length);
    for (const e of g.edges) {
      expect(e.from).not.toBe(e.to);
      expect(topicById(e.from)).toBeDefined();
      expect(topicById(e.to)).toBeDefined();
    }
  });

  it("四种关系类型在边里都能找到", () => {
    const kinds = new Set(emptyGraph().edges.map((e) => e.kind));
    expect([...kinds].sort()).toEqual(["contrast", "downstream", "prerequisite", "same-doc"]);
  });
});

describe("relatedTopics 顺着查", () => {
  it("depth 0 / 未知 id 返回空", () => {
    expect(relatedTopics("ordering.available-qty", 0)).toEqual([]);
    expect(relatedTopics("nope.nope")).toEqual([]);
  });

  it("默认 1 层就是直接关联，2 层是 1 层的超集且更大", () => {
    const one = relatedTopics("ordering.net-shortage");
    const two = relatedTopics("ordering.net-shortage", 2);
    expect(one.length).toBe(topicById("ordering.net-shortage")!.relatedTo.length);
    expect(two.length).toBeGreaterThan(one.length);
    for (const t of one) expect(two.map((x) => x.id)).toContain(t.id);
    expect(two.map((t) => t.id)).not.toContain("ordering.net-shortage");
    expect(new Set(two.map((t) => t.id)).size).toBe(two.length);
  });
});
