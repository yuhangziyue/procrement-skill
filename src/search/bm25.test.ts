import { describe, expect, it } from "vitest";
import { Bm25Index, tokenize } from "./bm25";

function buildIndex() {
  const idx = new Bm25Index<{ tag: string }>();
  idx.add("order", "场景1：生产部门给生产表，缺的料去找供应商下单。下单量 = 生产需求 − 可用库存 − 在途量", { tag: "下单" });
  idx.add("receipt", "到货预告：提前 1 天给仓库发到货计划；货到录到货单，仓库审核采购入库单后库存增加", { tag: "入库" });
  idx.add("tracking", "每日跟单：看采购订单执行情况统计表，逾期行当天电话供应商催货并通知生产", { tag: "跟踪" });
  idx.add("code", "存货编码 1100002 腰封A 500只/扎 MOQ 2000 供应商回签交期 L/T 7 天", { tag: "编码" });
  return idx;
}

describe("tokenize", () => {
  it("中文切 bigram，英文/数字整段小写 token，标点丢弃", () => {
    expect(tokenize("生产缺料")).toEqual(["生产", "产缺", "缺料"]);
    expect(tokenize("MOQ 2000，L/T 7天")).toEqual(["moq", "2000", "l", "t", "7", "天"]);
    expect(tokenize("编码1100002")).toEqual(["编码", "1100002"]);
  });

  it("空串 / 纯标点 → []", () => {
    expect(tokenize("")).toEqual([]);
    expect(tokenize("，。！ —— ")).toEqual([]);
  });
});

describe("Bm25Index", () => {
  it("中文查询命中对应文档并带回 meta", () => {
    const hits = buildIndex().search("生产缺料要下单");
    expect(hits[0].id).toBe("order");
    expect(hits[0].meta?.tag).toBe("下单");
    expect(hits[0].score).toBeGreaterThan(0);
  });

  it("编码「1100002」精确命中", () => {
    const hits = buildIndex().search("1100002");
    expect(hits.length).toBe(1);
    expect(hits[0].id).toBe("code");
  });

  it("无关查询：不命中或分数远低于相关命中", () => {
    const idx = buildIndex();
    const related = idx.search("到货入库")[0].score;
    const unrelated = idx.search("量子力学薛定谔方程");
    const top = unrelated[0]?.score ?? 0;
    expect(top).toBeLessThan(related / 3);
  });

  it("多文档排序：主题最贴的排第一，k 截断", () => {
    const idx = buildIndex();
    const hits = idx.search("供应商逾期催货", 2);
    expect(hits.length).toBe(2);
    expect(hits[0].id).toBe("tracking");
    expect(hits[0].score).toBeGreaterThan(hits[1].score);
  });

  it("空索引 / 空查询 / k<=0 → []", () => {
    expect(new Bm25Index().search("下单")).toEqual([]);
    expect(buildIndex().search("")).toEqual([]);
    expect(buildIndex().search("   ，。")).toEqual([]);
    expect(buildIndex().search("下单", 0)).toEqual([]);
  });

  it("同 id 重复 add 视为替换，df 不累积", () => {
    const idx = new Bm25Index();
    idx.add("a", "到货入库");
    idx.add("a", "逾期催货");
    expect(idx.size).toBe(1);
    expect(idx.search("到货")).toEqual([]);
    expect(idx.search("催货")[0].id).toBe("a");
  });
});
