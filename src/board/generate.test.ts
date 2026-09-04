// 卡片生成的回归测试。用真实的物料和供应商：三拼腰封AL / 彩印纸盒A / 瓦楞隔板 / 单片贴纸，
// 供应商示例包材、样例纸品——测试数据长得像她手上的表，出问题一眼能看出是哪种情形。
import { describe, expect, it } from "vitest";
import { assertCard, conflictCard, generateTasks, nearestCodes, normalizeHeader, pickColumn, stageOf, taskId, workdaysBetween, STAGE_OF } from "./generate";
import { bandFactsOf, bandOf } from "./band";
import { TUTORIAL_OF } from "../tutorial/link";
import type { BoardTask } from "./types";

const BIZ = "2026-09-03"; // 周四

const MATERIALS: Record<string, string>[] = [
  { 物料编码: "1110919", 物料名称: "三拼腰封AL", 采购状态: "在购-日配", 供应商: "示例包材", 日均用量: "3353", MOQ: "5000", 凑整单位: "500", 单价: "0.4", 准交率: "0.9" },
  { 物料编码: "11101011", 物料名称: "彩印纸盒A", 采购状态: "在购", 供应商: "样例纸品", 单价: "1.2", 准交率: "0.85" },
  { 物料编码: "1107870", 物料名称: "瓦楞隔板", 采购状态: "停购-已下架", 供应商: "样例纸品" },
  { 物料编码: "1107859", 物料名称: "单片贴纸", 采购状态: "在购-警示将下架", 供应商: "样例纸品", 单价: "0.05" },
];
const INVENTORY: Record<string, string>[] = [{ 存货编码: "1110919", 仓库: "包材仓", 现存量: "3000", 可用量: "1600" }];
const PO_LINES: Record<string, string>[] = [
  { 订单号: "PO26-0863", 供应商: "示例包材", 物料编码: "1110919", 物料名称: "三拼腰封AL", 数量: "20000", 未到数量: "20000", 承诺交期: "2026-09-01", 状态: "已发货在途", 物流单号: "SF7788" },
  { 订单号: "PO26-0871", 供应商: "样例纸品", 物料编码: "11101011", 物料名称: "彩印纸盒A", 数量: "5000", 未到数量: "5000", 承诺交期: "2026-09-04", 状态: "未发货" },
  { 订单号: "PO26-0874", 供应商: "示例包材", 物料编码: "11101016", 物料名称: "内衬纸托", 数量: "8000", 未到数量: "8000", 承诺交期: "2026-09-12", 状态: "已发货在途", 物流单号: "JD660901" },
  { 订单号: "PO26-0880", 供应商: "样例纸品", 物料编码: "1107859", 物料名称: "单片贴纸", 数量: "12000", 未到数量: "12000", 承诺交期: "2026-09-03", 状态: "已到待入库" },
];
const PRODUCTION: Record<string, string>[] = [
  { 存货编码: "1110919", 存货名称: "三拼腰封AL", 需求数量: "20000", 需求日期: "2026-09-30", 需求仓库: "包材仓" },
  { 存货编码: "9999999", 存货名称: "临时打样件", 需求数量: "500", 需求日期: "2026-09-20" },
  { 存货编码: "1107870", 需求数量: "3000", 需求日期: "2026-09-08" },
  { 存货编码: "11101011", 需求数量: "6000", 需求日期: "2026-09-07" },
];

const full = () => generateTasks(
  { production: PRODUCTION, materials: MATERIALS, inventory: INVENTORY, poLines: PO_LINES, arrivals: [{ 订单号: "PO26-0855", 物料编码: "11101011", 订单数量: "5000", 实到数量: "4700", 累计入库: "0" }] },
  BIZ,
);
const kindsOf = (ts: BoardTask[]) => ts.map((t) => t.kind);
const byKind = (ts: BoardTask[], k: BoardTask["kind"]) => ts.filter((t) => t.kind === k);

describe("优雅降级：只导一张生产表也要出卡", () => {
  it("只有生产表 → 「要下单」泳道照样有卡", () => {
    const { tasks } = generateTasks({ production: [{ 存货编码: "11101011", 需求数量: "6000", 需求日期: "2026-09-30" }] }, BIZ);
    expect(tasks.length).toBeGreaterThan(0);
    expect(tasks.every((t) => t.stage === "to_order")).toBe(true);
    expect(kindsOf(tasks)).toContain("T1_shortage");
  });

  it("缺的表都在 warnings 里用人话说清退化成了什么口径，不闷声用默认值", () => {
    const { warnings } = generateTasks({ production: [{ 存货编码: "11101011", 需求数量: "6000", 需求日期: "2026-09-30" }] }, BIZ);
    const all = warnings.join("\n");
    expect(all).toContain("没有导物料表");
    expect(all).toContain("没有导现存量表");
    expect(all).toContain("没有导跟单表");
    expect(all).toContain("供应商档案");
    expect(all).not.toContain("undefined");
  });

  it("现存量表只有现存量没有可用量 → 明确警告缺口会偏小、容易少下单", () => {
    const { warnings } = generateTasks(
      { production: PRODUCTION, materials: MATERIALS, inventory: [{ 存货编码: "1110919", 现存量: "3000" }] },
      BIZ,
    );
    expect(warnings.join()).toContain("现存量里含被别的订单预占");
  });

  it("跟单表没有承诺到货日列 → 说清逾期判断退化为按需求日", () => {
    const { warnings } = generateTasks(
      { production: PRODUCTION, materials: MATERIALS, poLines: [{ 订单号: "PO26-0900", 物料编码: "1110919", 数量: "2000", 状态: "未发货" }] },
      BIZ,
    );
    expect(warnings.join()).toContain("没有「承诺到货日」列");
  });

  it("空输入不炸，返回空卡片空警告", () => {
    expect(generateTasks({}, BIZ)).toEqual({ tasks: [], warnings: [] });
  });
});

describe("T3 拦截确认：停购 / 警示 / 编码对不上", () => {
  it("停购-已下架的料只出拦截卡，绝不出下单卡", () => {
    const { tasks } = full();
    const t = byKind(tasks, "T3_intercept").find((x) => x.materialCode === "1107870")!;
    expect(t.title).toContain("停购-已下架");
    expect(byKind(tasks, "T1_shortage").some((x) => x.materialCode === "1107870")).toBe(false);
    expect(t.steps.map((s) => s.text).join()).toContain("复用旧包材");
  });

  it("编码在 152 项里查不到 → 给最相近的三个编码供人工核对，不自动替换", () => {
    const t = byKind(full().tasks, "T3_intercept").find((x) => x.materialCode === "9999999")!;
    expect(t.title).toContain("编码未命中");
    const text = t.steps.map((s) => s.text).join();
    expect(text).toContain("不猜、不借用相近编码");
    expect(text).toMatch(/1110919|11101011|1107870|1107859/);
  });

  it("警示将下架的料：可以下，但话术是先确认物料还活着、量放保守", () => {
    const { tasks } = generateTasks(
      { production: [{ 存货编码: "1107859", 需求数量: "20000", 需求日期: "2026-09-30" }], materials: MATERIALS },
      BIZ,
    );
    const t = byKind(tasks, "T3_intercept")[0];
    expect(t.title).toContain("警示将下架");
    expect(t.steps.map((s) => s.text).join()).toContain("量放保守");
  });

  it("拦截卡的完成判定是「发出且有书面答复」，只发出不算完", () => {
    const t = byKind(full().tasks, "T3_intercept")[0];
    expect(t.doneRule).toContain("只发出没回话 = 未完成");
    expect(t.escalation).toContain("48 小时");
  });
});

describe("T1 / T1-B 下单", () => {
  it("需求日还早 → 出下单卡，数量按 MOQ + 凑整单位向上取整", () => {
    const t = byKind(full().tasks, "T1_shortage").find((x) => x.materialCode === "1110919")!;
    expect(t.qty).toBe(18500); // 需求 20000 − 可用 1600 = 18400，按 500/扎 凑整
    expect(t.title).toContain("18500");
    expect(t.dueDate).toBeTruthy();
  });

  it("逾期未决的在途不算有效在途——PO26-0863 已逾期，缺口不因为它变小", () => {
    const t = byKind(full().tasks, "T1_shortage").find((x) => x.materialCode === "1110919")!;
    expect(t.steps[0].text).toContain("剔干净");
    expect(t.qty).toBe(18500);
  });

  it("最晚下单日已经过去 → 转 T1-B「来不及」，要的是补救不是下单", () => {
    const t = byKind(full().tasks, "T1B_late").find((x) => x.materialCode === "11101011")!;
    expect(t.title).toContain("补救方案");
    expect(t.steps.map((s) => s.text).join()).toContain("要文字报价，不认口头");
    expect(t.escalation).toContain("16:00");
    expect(t.score).toBeGreaterThan(50);
  });

  it("库存 + 在途够用 → 一张卡都不出（不制造假活）", () => {
    const { tasks } = generateTasks(
      { production: [{ 存货编码: "11101011", 需求数量: "1000", 需求日期: "2026-09-30" }], materials: MATERIALS, inventory: [{ 存货编码: "11101011", 可用量: "5000" }] },
      BIZ,
    );
    expect(byKind(tasks, "T1_shortage")).toHaveLength(0);
  });

  it("下单卡的完成判定认 U8 已审核，明说「保存 ≠ 生效」", () => {
    const t = byKind(full().tasks, "T1_shortage")[0];
    expect(t.doneRule).toContain("已审核");
    expect(t.steps.map((s) => s.text + s.where).join()).toContain("保存 ≠ 生效");
  });
});

describe("T4 / T5 / T7 / T8：跟单表分流", () => {
  it("承诺交期已过 → 逾期催货卡，落在「在途催货」泳道，标题带逾期天数", () => {
    const t = byKind(full().tasks, "T8_overdue")[0];
    expect(t.stage).toBe("transit");
    expect(t.title).toContain("已逾期");
    expect(t.steps[0].text).toContain("为什么晚");
    expect(t.doneRule).toContain("只打了电话没通知生产 = 未完成");
  });

  it("已到待入库 → 到货入库泳道的催入库卡，判定以 U8 累计入库为准", () => {
    const t = byKind(full().tasks, "T7_not_stocked").find((x) => x.poNo === "PO26-0880")!;
    expect(t.stage).toBe("inbound");
    expect(t.doneRule).toContain("不认口头");
    expect(t.escalation).toContain("我来配合");
    expect(t.escalation).toContain("主管");
  });

  it("未发货且没回签 → 并入「待下单」道（回签前订单只是一厢情愿），明说「好的」不算回签", () => {
    const t = byKind(full().tasks, "T4_unconfirmed")[0];
    expect(t.stage).toBe("to_order");
    expect(t.doneRule).toContain("回一句「好的」不算回签");
    expect(t.escalation).toContain("抄送");
  });

  it("在途未到期 → 在途跟踪卡；有运单号盯节点，没运单号先要运单号", () => {
    const t = byKind(full().tasks, "T5_transit")[0];
    expect(t.title).toContain("物流节点");
    expect(t.steps.map((s) => s.text).join()).toContain("物流公司 + 运单号 + 预计到达日");
    const noTn = generateTasks({ poLines: [{ 订单号: "PO26-0899", 供应商: "样例纸品", 物料编码: "1107859", 数量: "3000", 承诺交期: "2026-09-15", 状态: "已发货在途" }] }, BIZ);
    expect(byKind(noTn.tasks, "T5_transit")[0].title).toContain("要");
    expect(byKind(noTn.tasks, "T5_transit")[0].title).toContain("运单号");
  });

  it("已完结的行不再生成任何卡", () => {
    const { tasks } = generateTasks({ poLines: [{ 订单号: "PO26-0700", 物料编码: "1107859", 数量: "100", 承诺交期: "2026-08-01", 状态: "已入库完结" }] }, BIZ);
    expect(tasks).toHaveLength(0);
  });

  it("明天有承诺到货 → 出一张明日到货预告卡，完成判定要仓库回执", () => {
    const t = byKind(full().tasks, "T6_notice")[0];
    expect(t.title).toContain("发明日到货预告");
    expect(t.doneRule).toContain("没人回 = 没发出");
  });
});

describe("T9 到货差异", () => {
  it("实到 ≠ 订单数量 → 差异卡，分类写清欠交多少", () => {
    const t = byKind(full().tasks, "T9_discrepancy")[0];
    expect(t.title).toContain("欠交 300");
    expect(t.steps.map((s) => s.text).join()).toContain("当天");
    expect(t.doneRule).toContain("两边都有书面记录");
  });

  it("超交走「先请示再收」，不许自作主张", () => {
    const { tasks } = generateTasks({ arrivals: [{ 订单号: "PO26-0856", 物料编码: "1107859", 订单数量: "10000", 实到数量: "10800" }], materials: MATERIALS }, BIZ);
    const t = byKind(tasks, "T9_discrepancy")[0];
    expect(t.title).toContain("超交 800");
    expect(t.steps.map((s) => s.text).join()).toContain("先请示再收");
  });

  it("质检不合格也算差异，哪怕数量对得上", () => {
    const { tasks } = generateTasks({ arrivals: [{ 订单号: "PO26-0857", 物料编码: "1107859", 订单数量: "10000", 实到数量: "10000", 质检结论: "不合格" }], materials: MATERIALS }, BIZ);
    expect(byKind(tasks, "T9_discrepancy")[0].title).toContain("质检不合格");
  });

  it("到货了但累计入库没涨 → 催入库卡", () => {
    const { tasks } = generateTasks({ arrivals: [{ 订单号: "PO26-0858", 物料编码: "1107859", 订单数量: "10000", 累计到货: "10000", 累计入库: "4000" }], materials: MATERIALS }, BIZ);
    const t = byKind(tasks, "T7_not_stocked")[0];
    expect(t.title).toContain("累计入库才 4000");
    expect(t.qty).toBe(6000);
  });

  it("到货表没有实到数量列 → 警告说清差异判不出来", () => {
    const { warnings } = generateTasks({ arrivals: [{ 订单号: "PO26-0859", 物料编码: "1107859", 订单数量: "10000" }] }, BIZ);
    expect(warnings.join()).toContain("差异卡这一轮出不来");
  });
});

describe("T10 日配件水位巡检（她岗位的命门）", () => {
  it("日配件必出巡检卡，覆盖天数写进标题", () => {
    const t = byKind(full().tasks, "T10_daily_check")[0];
    expect(t.materialCode).toBe("1110919");
    expect(t.title).toContain("0.5 天");
    expect(t.title).toContain("水位告警");
  });

  it("覆盖 < 3 天的日配件命中 R1 置顶，分数超过任何常规卡", () => {
    const { tasks } = full();
    const t10 = byKind(tasks, "T10_daily_check")[0];
    expect(t10.reasons.join()).toContain("R1 置顶");
    expect(t10.score).toBeGreaterThan(100);
  });

  it("没填日均用量 → 不假装算得出覆盖天数，卡上直说去补分母", () => {
    const { tasks } = generateTasks({ materials: [{ 物料编码: "1107867", 物料名称: "封口贴", 采购状态: "在购-日配", 供应商: "示例包材" }] }, BIZ);
    const t = byKind(tasks, "T10_daily_check")[0];
    expect(t.steps[0].text).toContain("日均用量没填");
    expect(t.doneRule).toContain("已执行");
  });

  it("非日配件不出巡检卡", () => {
    expect(byKind(full().tasks, "T10_daily_check").some((t) => t.materialCode === "11101011")).toBe(false);
  });
});

describe("id 可重算：刷新不许把她勾过的步骤冲掉", () => {
  it("同一批数据跑两次，id 完全一致", () => {
    const a = full().tasks.map((t) => t.id).sort();
    const b = full().tasks.map((t) => t.id).sort();
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(a.length); // 不许撞 id
  });

  it("id = 类型 + 业务键 + 业务日，换一天就是另一张卡", () => {
    const today = full().tasks.find((t) => t.kind === "T10_daily_check")!.id;
    const { tasks } = generateTasks({ materials: MATERIALS, inventory: INVENTORY, poLines: PO_LINES }, "2026-09-04");
    const tomorrow = tasks.find((t) => t.kind === "T10_daily_check")!.id;
    expect(today).toBe("T10_daily_check|1110919|2026-09-03");
    expect(tomorrow).toBe("T10_daily_check|1110919|2026-09-04");
  });

  it("行顺序打乱不影响 id（她导表的行序每次都不一样）", () => {
    const a = generateTasks({ production: PRODUCTION, materials: MATERIALS, poLines: PO_LINES }, BIZ).tasks.map((t) => t.id).sort();
    const b = generateTasks({ production: [...PRODUCTION].reverse(), materials: [...MATERIALS].reverse(), poLines: [...PO_LINES].reverse() }, BIZ).tasks.map((t) => t.id).sort();
    expect(a).toEqual(b);
  });

  it("同一物料多行需求合并成一张卡，不刷屏", () => {
    const { tasks } = generateTasks(
      { production: [
        { 存货编码: "11101011", 需求数量: "3000", 需求日期: "2026-09-30" },
        { 存货编码: "11101011", 需求数量: "2000", 需求日期: "2026-10-12" },
      ], materials: MATERIALS },
      BIZ,
    );
    const t1 = byKind(tasks, "T1_shortage");
    expect(t1).toHaveLength(1);
    expect(t1[0].qty).toBe(5000);
    expect(t1[0].needDate).toBe("2026-09-30"); // 取最早的需求日
  });
});

describe("列名模糊匹配：四个来源的表，列名从来不统一", () => {
  it("「物料编码 / 存货编码 / 料号」都要认", () => {
    for (const key of ["物料编码", "存货编码", "料号", "物料代码"]) {
      const { tasks } = generateTasks({ production: [{ [key]: "11101011", 需求数量: "6000", 需求日期: "2026-09-30" }], materials: MATERIALS }, BIZ);
      expect(tasks[0]?.materialCode).toBe("11101011");
    }
  });

  it("带空格、括号、全角的列名照样认", () => {
    const { tasks } = generateTasks({ production: [{ "存货编码 ": "11101011", "需求数量（只）": "6000", 需求日: "2026-09-30" }], materials: MATERIALS }, BIZ);
    expect(tasks[0]?.materialCode).toBe("11101011");
    expect(tasks[0]?.qty).toBe(6000);
    expect(tasks[0]?.needDate).toBe("2026-09-30");
  });

  it("日期宽松解析：2026/9/30、2026.9.30、2026年9月30日 都归一成 YYYY-MM-DD", () => {
    for (const d of ["2026/9/30", "2026.9.30", "2026年9月30日"]) {
      const { tasks } = generateTasks({ production: [{ 存货编码: "11101011", 需求数量: "6000", 需求日期: d }], materials: MATERIALS }, BIZ);
      expect(tasks[0].needDate).toBe("2026-09-30");
    }
  });

  it("pickColumn 三级匹配：原样 → 归一化相等 → 归一化包含", () => {
    expect(pickColumn({ 物料编码: "A1" }, ["物料编码"])).toBe("A1");
    expect(pickColumn({ " 物料 编码 ": "A2" }, ["物料编码"])).toBe("A2");
    expect(pickColumn({ 存货编码本期: "A3" }, ["存货编码"])).toBe("A3");
    expect(pickColumn({ 物料编码: "   " }, ["物料编码"])).toBe("");
  });

  it("normalizeHeader 抹掉空格标点与全角差异", () => {
    expect(normalizeHeader("需求数量（只）")).toBe(normalizeHeader("需求数量 (只)"));
    expect(normalizeHeader("MOQ")).toBe("moq");
  });

  it("nearestCodes 按公共前缀给最像的三个，不自动替换", () => {
    expect(nearestCodes("1110920", ["1110919", "11101011", "1107859", "2201000"])).toEqual(["1110919", "11101011", "1107859"]);
  });
});

describe("卡片质量：苏姐铁律④，缺一项的卡不许生成", () => {
  const { tasks } = full();

  it("每张卡都答了「什么算干完」和「卡住了找谁 + 第一句话」", () => {
    for (const t of tasks) {
      expect(t.doneRule.length, t.title).toBeGreaterThan(10);
      expect((t.escalation ?? "").length, t.title).toBeGreaterThan(10);
      expect(t.steps.length, t.title).toBeGreaterThanOrEqual(3);
      expect(t.reasons.length, t.title).toBeGreaterThan(3);
    }
  });

  it("全场不许出现「跟进一下」这种废话", () => {
    const all = tasks.map((t) => [t.title, t.doneRule, t.escalation, ...t.steps.map((s) => s.text + (s.where ?? ""))].join(" ")).join("\n");
    expect(all).not.toContain("跟进一下");
    expect(all).not.toContain("undefined");
  });

  it("凡是提到 U8 菜单的文案一律带 ⚠️ 待实机核对", () => {
    for (const t of tasks) for (const s of t.steps) {
      if (s.where?.startsWith("U8：")) expect(s.where).toContain("⚠️ 待实机核对");
    }
  });

  it("标题是动作式的，动词开头", () => {
    for (const t of tasks) expect(t.title).toMatch(/^(下单|找|催|要|盯|发|定性|录|处理)/);
  });

  it("泳道映射按 v2 四泳道，一张卡只有一个家", () => {
    for (const t of tasks) expect(t.stage).toBe(stageOf(t.kind, { hasAuth: bandFactsOf(t).hasAuth }));
    expect(new Set(tasks.map((t) => t.stage))).toEqual(new Set(["demand", "to_order", "transit", "inbound"]));
  });
});

describe("工作日口径（不是自然日）", () => {
  it("周四到下周一 = 2 个工作日，周末不算", () => {
    expect(workdaysBetween("2026-09-03", "2026-09-07")).toBe(2);
  });

  it("反向为负：最晚动作日过去了就是负数", () => {
    expect(workdaysBetween("2026-09-07", "2026-09-03")).toBe(-2);
    expect(workdaysBetween("2026-09-03", "2026-09-03")).toBe(0);
  });

  it("跨国庆长假：法定节假日不计入工作日", () => {
    expect(workdaysBetween("2026-09-30", "2026-10-08")).toBeLessThan(3);
  });

  it("taskId 把空白键收敛掉，不产出带空格的 id", () => {
    expect(taskId("T1_shortage", " PO26 0871 ", BIZ)).toBe("T1_shortage|PO26_0871|2026-09-03");
  });
});

/* ═══════════ v2：三档 / 主操作 / 教程联动 / 两类新卡 ═══════════ */

const ADDON = (auth: boolean): Record<string, string>[] => [{
  物料编码: "11101011", 物料名称: "彩印纸盒A", 数量: "2000", 需求日期: "2026-09-20",
  提出人: "生产二线", 是否急: "否",
  ...(auth ? { 授权人: "车间主管", 授权凭据: "微信截图20260903" } : {}),
}];

describe("v2 泳道：T2 加单按授权分流，一张卡只有一个家", () => {
  it("授权齐 → 待下单道；授权没齐 → 需求道（球在提出人那边）", () => {
    const withAuth = generateTasks({ addon: ADDON(true), materials: MATERIALS }, BIZ).tasks[0];
    const noAuth = generateTasks({ addon: ADDON(false), materials: MATERIALS }, BIZ).tasks[0];
    expect(withAuth.stage).toBe("to_order");
    expect(noAuth.stage).toBe("demand");
    expect(stageOf("T2_addon", { hasAuth: true })).toBe("to_order");
    expect(stageOf("T2_addon", { hasAuth: false })).toBe("demand");
    // 表本身也要对：v2 四个枚举值，一个 order/confirm 都不许留
    expect(new Set(Object.values(STAGE_OF))).toEqual(new Set(["demand", "to_order", "transit", "inbound"]));
    expect(STAGE_OF.T4_unconfirmed).toBe("to_order");
    expect(STAGE_OF.T13_payment).toBe("inbound");
  });

  it("拦截 / 来不及 / 日配巡检都落「需求」道", () => {
    const { tasks } = full();
    for (const t of tasks.filter((x) => ["T3_intercept", "T1B_late", "T10_daily_check", "T14_conflict"].includes(x.kind))) {
      expect(t.stage, t.title).toBe("demand");
    }
  });
});

describe("v2 每张卡的新字段：band / 主操作 / 教程 / 覆盖天数", () => {
  const { tasks } = full();

  it("每张卡都带三档判定的三件套，bandRule 能在规则表里查到", () => {
    for (const t of tasks) {
      expect(["urgent", "follow", "notice"], t.title).toContain(t.band);
      expect(t.bandRule, t.title).toMatch(/^[UFN]\d+$/);
      expect(t.bandWhy.length, t.title).toBeGreaterThan(6);
      expect(bandOf(t, { bizDate: BIZ }).ruleId, t.title).toBe(t.bandRule);
    }
  });

  it("每张卡一个动词 + 1~2 格凭据，至少一格必填", () => {
    for (const t of tasks) {
      expect(t.primaryAction.label, t.title).toMatch(/[→>]|已|要|催|录|问|拿/);
      expect(t.primaryAction.evidence.length, t.title).toBeGreaterThanOrEqual(1);
      expect(t.primaryAction.evidence.length, t.title).toBeLessThanOrEqual(2);
      expect(t.primaryAction.evidence.some((e) => e.required), t.title).toBe(true);
    }
  });

  it("gate 步骤每卡最多 2 条，其余一律 hint", () => {
    for (const t of tasks) {
      expect(t.steps.filter((s) => s.role === "gate").length, t.title).toBeLessThanOrEqual(2);
      for (const s of t.steps) expect(["gate", "hint"], t.title).toContain(s.role);
    }
  });

  it("gate 超过 2 条是构建期错误，直接抛，不静默降级", () => {
    const bad = {
      kind: "T1_shortage" as const, key: "x",
      primaryAction: { id: "a", label: "干完了 →", actionKind: "record" as const, evidence: [{ key: "k", label: "凭据", type: "text" as const, required: true }] },
      steps: [1, 2, 3].map((n) => ({ id: `s${n}`, text: `第 ${n} 步`, role: "gate" as const })),
    };
    expect(() => assertCard(bad)).toThrow(/gate/);
    expect(() => assertCard({ ...bad, steps: bad.steps.slice(0, 2) })).not.toThrow();
  });

  it("主操作凭据超过 2 格也抛——那是表单，不是「填一下就算干完」", () => {
    expect(() => assertCard({
      kind: "T1_shortage", key: "x", steps: [],
      primaryAction: { id: "a", label: "干完了 →", actionKind: "record", evidence: ["a", "b", "c"].map((k) => ({ key: k, label: k, type: "text" as const, required: true })) },
    })).toThrow(/凭据/);
  });

  it("每张卡都挂了主教程，且与 TUTORIAL_OF 一致", () => {
    for (const t of tasks) expect(t.tutorialId, t.title).toBe(TUTORIAL_OF[t.kind]);
  });

  it("U8 指引：unknown 档不许带路径，必须给「问谁 + 开口第一句」", () => {
    const refs = tasks.flatMap((t) => [t.primaryAction.u8Path, ...t.steps.map((s) => s.u8Path)]).filter(Boolean);
    for (const r of refs) {
      if (r!.confidence === "unknown") {
        expect(r!.path).toBe("");
        expect(r!.openQuestionId).toBeTruthy();
        expect(r!.askScript).toContain("问老采购一句");
      } else {
        expect(r!.path.length).toBeGreaterThan(4);
      }
    }
  });

  it("下单卡的路径条来自教程真实数据，可信度不是手抄的", () => {
    const t = byKind(tasks, "T1_shortage")[0];
    expect(t.primaryAction.actionKind).toBe("u8");
    expect(t.primaryAction.u8Path!.confidence).toBe("unverified");
    expect(t.primaryAction.u8Path!.path).toContain("采购订单");
  });

  it("日配巡检卡把覆盖天数落库，band 判定与卡面都用它，不每次现算", () => {
    const t = byKind(tasks, "T10_daily_check")[0];
    expect(typeof t.coverageDays).toBe("number");
  });
});

describe("T13 催付款：节点 ≤ 明天才造卡", () => {
  const line = (d: string) => [{ 订单号: "PO26-0888", 物料编码: "11101011", 数量: "5000", 状态: "已到待入库", 付款到期日: d }];

  it("付款节点是明天 → 出一张 T13，落「入库」道，命中 U9 紧急", () => {
    const { tasks } = generateTasks({ poLines: line("2026-09-04"), materials: MATERIALS }, BIZ);
    const t = byKind(tasks, "T13_payment")[0];
    expect(t).toBeTruthy();
    expect(t.stage).toBe("inbound");
    expect(t.band).toBe("urgent");
    expect(t.bandRule).toBe("U9");
    expect(t.title.startsWith("催")).toBe(true);
  });

  it("节点还有半个月 → 不造卡（每天摆在她面前只会变噪音）", () => {
    const { tasks } = generateTasks({ poLines: line("2026-09-20"), materials: MATERIALS }, BIZ);
    expect(byKind(tasks, "T13_payment")).toHaveLength(0);
  });

  it("没有付款/开票列 → 这一类这一轮就是空的，不猜", () => {
    expect(byKind(full().tasks, "T13_payment")).toHaveLength(0);
  });

  it("开票节点到期同样出卡，文案说的是开票不是付款", () => {
    const { tasks } = generateTasks({ poLines: [{ 订单号: "PO26-0889", 物料编码: "11101011", 状态: "未发货", 开票日期: BIZ }], materials: MATERIALS }, BIZ);
    expect(byKind(tasks, "T13_payment")[0].title).toContain("开票");
  });
});

describe("T14 冲突：判断层与事实层对不上，去改数据源", () => {
  it("生产表的名称与物料档案对不上 → 出一张核对卡，落「需求」道、提醒档", () => {
    const { tasks } = generateTasks(
      { production: [{ 存货编码: "11101011", 存货名称: "彩印纸盒B（旧版）", 需求数量: "1000", 需求日期: "2026-09-30" }], materials: MATERIALS },
      BIZ,
    );
    const t = byKind(tasks, "T14_conflict")[0];
    expect(t).toBeTruthy();
    expect(t.stage).toBe("demand");
    expect(t.bandRule).toBe("N4");
    expect(t.title).toContain("彩印纸盒");
  });

  it("名称一致就不造卡，不制造噪音", () => {
    const { tasks } = generateTasks(
      { production: [{ 存货编码: "11101011", 存货名称: "彩印纸盒A", 需求数量: "1000", 需求日期: "2026-09-30" }], materials: MATERIALS },
      BIZ,
    );
    expect(byKind(tasks, "T14_conflict")).toHaveLength(0);
  });

  it("[用这个] 手动触发的核对卡：只记判断，绝不替她改 U8", () => {
    const t = conflictCard(
      { materialCode: "11101011", materialName: "彩印纸盒A", field: "货码", factValue: "11101011", myValue: "11101016", where: "生产计划" },
      { bizDate: BIZ, now: 1 },
    );
    expect(t.kind).toBe("T14_conflict");
    expect(t.steps.some((s) => s.text.includes("不替你改 U8"))).toBe(true);
    expect(t.primaryAction.evidence[0].options).toContain("U8 存货档案");
  });
});
