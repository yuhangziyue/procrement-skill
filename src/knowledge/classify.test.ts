import { describe, expect, it } from "vitest";
import { CATEGORIES, MIN_SCORE, categoryName, classify, isCategoryId, majorityCategory } from "./classify";

const cat = (text: string, heading?: string) => classify(text, heading).category;

describe("CATEGORIES", () => {
  it("固定 10 类，id 唯一且含 other", () => {
    expect(CATEGORIES).toHaveLength(10);
    expect(new Set(CATEGORIES.map((c) => c.id)).size).toBe(10);
    expect(CATEGORIES.at(-1)!.id).toBe("other");
    expect(CATEGORIES.every((c) => c.name && c.desc)).toBe(true);
  });

  it("categoryName / isCategoryId", () => {
    expect(categoryName("u8")).toBe("系统操作(U8)");
    expect(categoryName("不存在")).toBe("其他");
    expect(isCategoryId("ordering")).toBe(true);
    expect(isCategoryId("nope")).toBe(false);
  });
});

describe("classify 十类各归其位", () => {
  it("岗位基础", () => {
    expect(cat("采购的 5R 原则是在合适的时间、以合适的价格拿到合适的数量，QCDS 讲的是质量成本交期服务。")).toBe("basics");
  });

  it("系统操作(U8)", () => {
    expect(cat("在 U8 里从「业务工作 - 供应链」进去，参照订单生单以后记得点保存再审核单据。")).toBe("u8");
  });

  it("下单与算量", () => {
    expect(cat("按生产缺料表算出净需求，遇到 MOQ 500 个要凑整，再按提前期倒推最晚下单日。")).toBe("ordering");
  });

  it("供应商与商务", () => {
    expect(cat("这家供应商的报价单有效期只有 7 天，比价之后还得议价，账期争取谈成月结 60。")).toBe("supplier");
  });

  it("到货与入库", () => {
    expect(cat("到货预告发出来以后，仓库点数签收，质检报检合格才能做入库单。")).toBe("inbound");
  });

  it("对账与付款", () => {
    expect(cat("月底和供应商对账，对账单确认后开专票，价税合计核对无误再走付款申请。")).toBe("finance");
  });

  it("跨部门协作", () => {
    expect(cat("生产部临时改计划，先跟计划部对接确认口径，再把变更同步给仓管，话术要留有余地。")).toBe("collab");
  });

  it("公司制度流程", () => {
    expect(cat("供应商准入必须走审批权限矩阵，收受回扣是廉洁红线，违规一律按公司管理办法处罚。")).toBe("policy");
  });

  it("物料与技术", () => {
    expect(cat("新料的物料编码按编码规则申请，规格书和承认书齐了才能建档，替代料要走 ECN 工程变更。")).toBe("material");
  });

  it("兜底 other：跟采购无关的闲聊", () => {
    expect(cat("今天天气不错，中午食堂的红烧肉卖完了。")).toBe("other");
  });

  it("兜底 other：只有一个弱词，够不上阈值", () => {
    const r = classify("这个界面挺好看的。");
    expect(r.category).toBe("other");
    expect(r.score).toBeLessThan(MIN_SCORE);
  });
});

describe("打分细节", () => {
  it("标题里的关键词加倍权重，能把摇摆的正文拉过去", () => {
    const body = "先确认数量，再确认时间。";
    expect(classify(body, "U8 操作手册").category).toBe("u8");
    expect(classify(body, "供应商报价管理").category).toBe("supplier");
  });

  it("同一个词刷屏也最多按 3 次算", () => {
    const three = classify("供应商供应商供应商");
    const ten = classify("供应商".repeat(10));
    expect(ten.score).toBe(three.score);
  });

  it("ASCII 词有边界，bom 不会被 bomb 命中", () => {
    expect(classify("the bomb exploded").scores.material).toBe(0);
    expect(classify("这张 BOM 表要展开").scores.material).toBeGreaterThan(0);
  });

  it("hits 里带出命中的词，便于排错", () => {
    const r = classify("到货预告发出来以后要质检报检。");
    expect(r.hits.map((h) => h.word)).toContain("到货预告");
    expect(r.hits.length).toBeLessThanOrEqual(8);
  });
});

describe("majorityCategory", () => {
  it("取众数，忽略 other", () => {
    expect(majorityCategory([
      { category: "other" }, { category: "u8" }, { category: "u8" }, { category: "inbound" }, { category: "other" },
    ])).toBe("u8");
  });

  it("平票时总分高的赢", () => {
    expect(majorityCategory([{ category: "u8", score: 5 }, { category: "inbound", score: 20 }])).toBe("inbound");
  });

  it("全是 other → other；空数组 → other", () => {
    expect(majorityCategory([{ category: "other" }, { category: "other" }])).toBe("other");
    expect(majorityCategory([])).toBe("other");
  });
});
