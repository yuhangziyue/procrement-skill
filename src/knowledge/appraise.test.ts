import { describe, expect, it } from "vitest";
import { appraiseDoc, type AppraiseChunk } from "./appraise";

const c = (text: string, heading = "", category = "other"): AppraiseChunk => ({ heading, text, category });

describe("appraiseDoc：边界与异常输入", () => {
  it("空 chunks + 空 title 不抛异常，给出合理默认值", () => {
    const r = appraiseDoc({ title: "", chunks: [] });
    expect(r.usefulness).toBe(1);
    expect(r.missing).toEqual([]);
    expect(r.topicsCovered).toEqual([]);
    expect(r.categories).toEqual([]);
    expect(r.outline).toEqual([]);
    expect(r.readingTime).toBe(1);
    expect(r.summary.length).toBeGreaterThan(0);
  });

  it("完全 malformed 输入（缺字段）不抛异常", () => {
    expect(() => appraiseDoc({} as any)).not.toThrow();
    expect(() => appraiseDoc({ title: undefined, chunks: undefined } as any)).not.toThrow();
    expect(() => appraiseDoc({ title: "x", chunks: [null, undefined, { text: 123 }] as any })).not.toThrow();
  });
});

describe("usefulness：按命中必备主题数分档（边界值）", () => {
  // 10 个互不相关的必备主题关键词，每个单独一块，避免互相污染计数
  const REQUIRED_KEYWORDS = [
    "三单匹配", "账套", "现存量查询", "可用量", "起订量",
    "提前期", "请购单", "比价", "账期", "到货预告",
  ];
  const fixture = (n: number) => REQUIRED_KEYWORDS.slice(0, n).map((k) => c(`这里提到${k}。`));

  it("命中 0 条必备主题 → usefulness 1，理由说明没命中", () => {
    const r = appraiseDoc({ title: "杂谈", chunks: [c("今天天气不错，随便聊聊。")] });
    expect(r.usefulness).toBe(1);
    expect(r.usefulnessWhy).toContain("没有命中任何必备主题");
  });

  it("命中 2 条必备主题（上边界）→ usefulness 2", () => {
    const r = appraiseDoc({ title: "t", chunks: fixture(2) });
    expect(r.usefulness).toBe(2);
  });

  it("命中 5 条必备主题（上边界）→ usefulness 3", () => {
    const r = appraiseDoc({ title: "t", chunks: fixture(5) });
    expect(r.usefulness).toBe(3);
  });

  it("命中 9 条必备主题（上边界）→ usefulness 4", () => {
    const r = appraiseDoc({ title: "t", chunks: fixture(9) });
    expect(r.usefulness).toBe(4);
  });

  it("命中 10 条必备主题 → usefulness 5，usefulnessWhy 列出可核对的主题名字", () => {
    const r = appraiseDoc({ title: "t", chunks: fixture(10) });
    expect(r.usefulness).toBe(5);
    expect(r.usefulnessWhy).toMatch(/命中 10 条必备主题/);
    // usefulnessWhy 里点名的主题，必须都能在 topicsCovered 里查到——这是「可核对」的硬要求
    const namedInWhy = r.usefulnessWhy.match(/必备主题[:：]([^；]+)/)?.[1] ?? "";
    const coveredNames = new Set(r.topicsCovered.map((t) => t.name));
    for (const name of namedInWhy.replace(/等$/, "").split("、")) {
      expect(coveredNames.has(name)).toBe(true);
    }
  });
});

describe("完整《采购管理制度》：命中面广、质量信号齐全", () => {
  const chunks: AppraiseChunk[] = [
    c("本制度自2024年3月1日起施行，版本v2.1，用于规范公司采购全流程，由采购部负责解释。", "总则", "policy"),
    c(
      "请购流程分为三步：第一步由需求部门提交请购单，第二步找主管审批，第三步转采购订单下单，提前期一般为15个工作日。",
      "下单 > 请购与订单",
      "ordering",
    ),
    c("下单前要先看可用量，不能只看现存量查询里的结存数量，否则容易多买。", "下单 > 可用量口径", "ordering"),
    c("采购订单起订量以供应商报价单为准，低于起订量时找采购专员协调分批。", "下单 > 起订量", "ordering"),
    c("登录U8前需要选对账套，找系统管理员申请账号和权限。", "系统操作", "u8"),
    c("询价比价至少三家，统一含税口径，账期一般为月结60天，由财务负责核对起算点。", "供应商管理", "supplier"),
    c("到货前一天发到货预告给仓管，到货登记由仓管签收，之后做入库单入库。", "到货与入库", "inbound"),
    c("发票与订单、入库单三单匹配，数量金额核对一致才能提交付款申请。", "对账与付款", "finance"),
    c("与仓库交接时要核对随货单据和标签，交接不清货物进不了库。", "跨部门协作", "collab"),
    c("涉及采购业务的廉洁红线：禁止收受回扣，发现利益冲突要主动上报，由品质部负责跟进异常。", "廉洁红线", "policy"),
  ];

  it("命中较多必备主题，usefulness 较高", () => {
    const r = appraiseDoc({ title: "采购管理制度", chunks });
    expect(r.usefulness).toBeGreaterThanOrEqual(4);
    expect(r.topicsCovered.length).toBeGreaterThan(5);
  });

  it("质量信号：数字、步骤、负责人、日期都检测到", () => {
    const r = appraiseDoc({ title: "采购管理制度", chunks });
    expect(r.quality.hasNumbers).toBe(true);
    expect(r.quality.hasSteps).toBe(true);
    expect(r.quality.hasOwners).toBe(true);
    expect(r.quality.hasDates).toBe(true);
  });

  it("信号齐全时不会无中生有地挂警告", () => {
    const r = appraiseDoc({ title: "采购管理制度", chunks });
    expect(r.quality.warnings).toEqual([]);
  });

  it("summary 读起来像人话：提到文档名、覆盖的环节、什么时候查，且不是首句拼接", () => {
    const r = appraiseDoc({ title: "采购管理制度", chunks });
    expect(r.summary).toContain("采购管理制度");
    expect(r.summary).toContain("适合");
    // 不等于任何一块原文的原样开头拼接（首句拼接的旧实现会让摘要以第一块原文开头）
    expect(r.summary.startsWith(chunks[0].text.slice(0, 10))).toBe(false);
    expect(r.summary.length).toBeGreaterThanOrEqual(60);
  });

  it("outline 取 3-8 条，heading 取标题链最后一段、去掉 Markdown 记号", () => {
    const r = appraiseDoc({ title: "采购管理制度", chunks });
    expect(r.outline.length).toBeGreaterThanOrEqual(3);
    expect(r.outline.length).toBeLessThanOrEqual(8);
    for (const o of r.outline) {
      expect(o.heading.length).toBeGreaterThan(0);
      expect(o.gist.length).toBeGreaterThan(0);
      expect(o.gist).not.toMatch(/^#/);
    }
  });

  it("categories 按字符占比降序排列，是完整分布", () => {
    const r = appraiseDoc({ title: "采购管理制度", chunks });
    for (let i = 1; i < r.categories.length; i++) {
      expect(r.categories[i - 1].ratio).toBeGreaterThanOrEqual(r.categories[i].ratio);
    }
    const sum = r.categories.reduce((s, x) => s + x.ratio, 0);
    expect(sum).toBeCloseTo(1, 5);
  });

  it("topicsCovered 按命中切片数从高到低排序", () => {
    const r = appraiseDoc({ title: "采购管理制度", chunks });
    for (let i = 1; i < r.topicsCovered.length; i++) {
      expect(r.topicsCovered[i - 1].hits).toBeGreaterThanOrEqual(r.topicsCovered[i].hits);
    }
  });
});

describe("missing：只从文档自己所属分类的必备主题里找，具体到后果", () => {
  it("inbound 类文档，只覆盖到货预告/到货登记，缺入库单/验收/欠交超交", () => {
    const chunks: AppraiseChunk[] = [
      c("到货前一天要发到货预告，告诉仓库准备好场地。", "到货预告", "inbound"),
      c("到货登记时仓管要签收送货单，确认到货数量。", "到货登记", "inbound"),
    ];
    const r = appraiseDoc({ title: "到货流程说明", chunks });
    expect(r.missing).toHaveLength(3);
    expect(r.missing.some((m) => m.includes("采购入库单与过账"))).toBe(true);
    expect(r.missing.some((m) => m.includes("来料验收标准"))).toBe(true);
    expect(r.missing.some((m) => m.includes("欠交、超交与拒收的处理"))).toBe(true);
    // 具体到后果，不是空话
    expect(r.missing.every((m) => m.length > 10 && !m.includes("建议补充相关资料"))).toBe(true);
    // 不该跨类别报别的分类的必备主题
    expect(r.missing.some((m) => m.includes("审批权限矩阵"))).toBe(false);
  });

  it("所属分类的必备主题全覆盖时，missing 为空数组，不硬凑", () => {
    const chunks: AppraiseChunk[] = [
      c("到货前一天发到货预告给仓库。", "", "inbound"),
      c("到货登记由仓管签收确认数量。", "", "inbound"),
      c("入库单过账后库存和应付同时更新。", "", "inbound"),
      c("来料验收按抽检标准判定合格与否，报检合格才能入库。", "", "inbound"),
      c("欠交超过约定天数要升级，超交超过范围可以拒收。", "", "inbound"),
    ];
    const r = appraiseDoc({ title: "到货完整流程", chunks });
    expect(r.missing).toEqual([]);
  });

  it("文档所属分类里没有必备主题（other 类）→ missing 为空", () => {
    const r = appraiseDoc({ title: "术语表", chunks: [c("这里是一些公司黑话和缩写的解释。", "", "other")] });
    expect(r.missing).toEqual([]);
  });
});

describe("纯表格数字的价格表：数字口径与警告的选择性", () => {
  const rows = Array.from(
    { length: 8 },
    (_, i) => `物料编码: 11000${i} | 品名: 五金件${i} | 单价: ${10 + i}.50元 | 起订量: ${100 + i * 10}件 | 供应商: 甲厂`,
  ).join("\n\n");

  it("hasNumbers 为真，不会因为是表格就被判成扫描件碎片", () => {
    const r = appraiseDoc({ title: "供应商价格表", chunks: [c(rows, "", "supplier")] });
    expect(r.quality.hasNumbers).toBe(true);
    expect(r.quality.warnings.some((w) => w.includes("扫描件"))).toBe(false);
    expect(r.quality.warnings.some((w) => w.includes("没有具体数字"))).toBe(false);
  });

  it("价格表本身不构成流程知识，usefulness 不高", () => {
    const r = appraiseDoc({ title: "供应商价格表", chunks: [c(rows, "", "supplier")] });
    expect(r.usefulness).toBeLessThanOrEqual(2);
    // usefulnessWhy 里若点名了某条必备主题，必须真的出现在 topicsCovered 里——不能凭空写
    const named = r.usefulnessWhy.match(/必备主题[:：]([^；]+)/)?.[1];
    if (named) {
      const coveredNames = new Set(r.topicsCovered.map((t) => t.name));
      for (const name of named.replace(/等$/, "").split("、")) expect(coveredNames.has(name)).toBe(true);
    }
  });
});

describe("空壳文档（只有标题没有正文）", () => {
  it("summary 说明内容缺失，usefulness 为 1，missing 为空", () => {
    const r = appraiseDoc({ title: "采购管理制度", chunks: [c("", "总则", "other")] });
    expect(r.usefulness).toBe(1);
    expect(r.missing).toEqual([]);
    expect(r.summary).toMatch(/空|寥寥|没有可读|内容/);
  });

  it("正文很少会挂「内容很少」的警告", () => {
    const r = appraiseDoc({ title: "采购管理制度", chunks: [c("待补充", "总则", "other")] });
    expect(r.quality.warnings.some((w) => w.includes("很少"))).toBe(true);
  });
});

describe("扫描件式短文本：破碎、少标点", () => {
  it("触发「文字比较破碎」的警告", () => {
    const lines = Array.from({ length: 14 }, () => "采 购 单 号");
    const r = appraiseDoc({ title: "到货单据", chunks: [c(lines.join("\n"), "", "inbound")] });
    expect(r.quality.warnings.some((w) => w.includes("扫描件"))).toBe(true);
  });
});

describe("制度类文档的生效日期警告", () => {
  const body =
    "采购管理制度规定审批权限矩阵按金额分档，超过额度要主管审批，联系人是行政部专员，涉及回扣一律走廉洁红线处理，找主管确认具体金额档次共5档。";

  it("没有生效日期/版本号 → 提示可能是旧版本", () => {
    const r = appraiseDoc({ title: "采购管理制度", chunks: [c(body, "总则", "policy")] });
    expect(r.quality.hasDates).toBe(false);
    expect(r.quality.warnings.some((w) => w.includes("生效日期"))).toBe(true);
  });

  it("写了版本号/生效日期就不会报这条警告", () => {
    const withDate = `本制度2024年5月1日起施行，版本v1.3。${body}`;
    const r = appraiseDoc({ title: "采购管理制度", chunks: [c(withDate, "总则", "policy")] });
    expect(r.quality.hasDates).toBe(true);
    expect(r.quality.warnings.some((w) => w.includes("生效日期"))).toBe(false);
  });

  it("非正式制度类文档（如话术卡）缺日期不报警", () => {
    const r = appraiseDoc({
      title: "催货话术卡",
      chunks: [c("催货时先问预计到货日期，再问卡在哪个环节，最后确认责任人和补救时间。", "", "collab")],
    });
    expect(r.quality.warnings.some((w) => w.includes("生效日期"))).toBe(false);
  });
});

describe("非数字密集分类缺数字不报警（避免每份文档都挂警告）", () => {
  it("basics/collab/policy 类内容没有数字，不强行挂「没有具体数字」的警告", () => {
    const r = appraiseDoc({
      title: "岗位职责说明",
      chunks: [
        c(
          "采购的职责边界包括算需求、下订单、跟催货物；不归采购管的事情要主动划清楚，避免出事时说不清楚责任。反复强调这一点很重要很重要很重要。",
          "职责边界",
          "basics",
        ),
      ],
    });
    expect(r.quality.hasNumbers).toBe(false);
    expect(r.quality.warnings.some((w) => w.includes("没有具体数字"))).toBe(false);
  });

  it("ordering/finance/u8/inbound/material 类缺数字才会报这条警告", () => {
    const r = appraiseDoc({
      title: "对账说明",
      chunks: [
        c(
          "月度对账要跟供应商核对金额，含税口径要统一，发票抬头和税号要提前确认清楚，发现差异要及时沟通处理，不能拖着不管。" +
            "对账的时候尤其要看清楚发票的品名规格跟采购订单是不是一致，避免退票重开耽误付款进度，这些都要靠对账那天核对，" +
            "核对不上就要当天联系供应商问清楚原因，不要拖到月底才处理，免得影响付款申请的进度。",
          "对账流程",
          "finance",
        ),
      ],
    });
    expect(r.quality.hasNumbers).toBe(false);
    expect(r.quality.warnings.some((w) => w.includes("没有具体数字"))).toBe(true);
  });
});

describe("readingTime：按总字数折算分钟，最少 1 分钟", () => {
  it("800 字 ≈ 2 分钟", () => {
    const r = appraiseDoc({ title: "t", chunks: [c("字".repeat(800))] });
    expect(r.readingTime).toBe(2);
  });

  it("再短的文档也至少算 1 分钟", () => {
    const r = appraiseDoc({ title: "t", chunks: [c("很短")] });
    expect(r.readingTime).toBe(1);
  });

  it("空文档也是 1 分钟，不会是 0", () => {
    const r = appraiseDoc({ title: "", chunks: [] });
    expect(r.readingTime).toBe(1);
  });
});
