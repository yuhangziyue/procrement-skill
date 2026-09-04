// 三档判定的回归测试。规格：DESIGN-workbench-v2「最终方案 · 2」的 28 条规则。
//
// 这份测试的形状就是规格那三张表：**一条规则一个正例，一条都不许少**，
// 最后再拿 BAND_RULES 反查一遍「有没有哪条规则一个正例都没有」——
// 规则表和测试表对不上时立刻红，不靠人肉对表。
import { describe, expect, it } from "vitest";
import { BAND_FACTS_KEY, BAND_RULES, bandOf, bandFactsOf, u10Proof, type BandFacts } from "./band";
import type { BoardTask, TaskKind } from "./types";

const BIZ = "2026-09-03"; // 周四
const ctx = { bizDate: BIZ };

let seq = 0;
function card(kind: TaskKind, p: Partial<BoardTask> = {}, facts: BandFacts = {}): BoardTask {
  return {
    id: p.id ?? `${kind}|${++seq}|${BIZ}`,
    kind,
    stage: p.stage ?? "to_order",
    band: "notice", bandRule: "N7", bandWhy: "",
    primaryAction: p.primaryAction ?? {
      id: "act", label: "干完了 →", actionKind: "record",
      evidence: [{ key: "proof", label: "凭据", type: "text", required: true }],
    },
    editable: p.editable ?? {},
    events: [],
    status: p.status ?? "todo",
    title: p.title ?? `处理 ${kind}`,
    materialCode: p.materialCode, materialName: p.materialName, supplier: p.supplier, poNo: p.poNo,
    qty: p.qty, needDate: p.needDate, promiseDate: p.promiseDate, dueDate: p.dueDate,
    arriveDate: p.arriveDate, coverageDays: p.coverageDays,
    isUrgent: p.isUrgent, awaitingApproval: p.awaitingApproval,
    score: p.score ?? 50, reasons: [], steps: [], doneSteps: [],
    doneRule: "已闭环", escalation: "找领导", bizDate: BIZ,
    sourceRow: { [BAND_FACTS_KEY]: facts },
    createdAt: 1, updatedAt: 1, closedAt: null,
  };
}

/** 规格三张表逐条的正例。表里的顺序 = 规格里的顺序，方便和文档对着看 */
const CASES: { rule: string; band: "urgent" | "follow" | "notice"; desc: string; task: BoardTask }[] = [
  // 🔴 紧急
  { rule: "U1", band: "urgent", desc: "下单已经来不及，要的是补救", task: card("T1B_late", { dueDate: BIZ }) },
  { rule: "U2", band: "urgent", desc: "最晚下单日就是今天", task: card("T1_shortage", { dueDate: BIZ }) },
  { rule: "U3", band: "urgent", desc: "加单表上标了急", task: card("T2_addon", { isUrgent: true, needDate: "2026-09-30" }, { hasAuth: true }) },
  { rule: "U4", band: "urgent", desc: "日配水位压到 3 天红线以下", task: card("T10_daily_check", { coverageDays: 1.8 }, { demandLevel: "daily" }) },
  { rule: "U5", band: "urgent", desc: "在途承诺今天到", task: card("T5_transit", { promiseDate: BIZ }) },
  { rule: "U6", band: "urgent", desc: "货今天到了还没入库", task: card("T7_not_stocked", { arriveDate: BIZ }) },
  { rule: "U7", band: "urgent", desc: "逾期且是日配件", task: card("T8_overdue", { dueDate: "2026-09-01" }, { demandLevel: "daily" }) },
  { rule: "U8", band: "urgent", desc: "差异比例 12% ≥ 10%", task: card("T9_discrepancy", {}, { demandLevel: "week", diffRatio: 0.12 }) },
  { rule: "U9", band: "urgent", desc: "付款节点最晚明天", task: card("T13_payment", { dueDate: "2026-09-04" }) },
  { rule: "U10", band: "urgent", desc: "分数反向通道：182 分把它顶上来", task: card("T5_transit", { promiseDate: "2026-09-20", score: 182.1 }) },
  // 🟡 日常跟进
  { rule: "F1", band: "follow", desc: "在途还有余量", task: card("T5_transit", { promiseDate: "2026-09-20", score: 40 }) },
  { rule: "F2", band: "follow", desc: "逾期但断不了料", task: card("T8_overdue", { dueDate: "2026-09-01", coverageDays: 9 }, { demandLevel: "week" }) },
  { rule: "F3", band: "follow", desc: "未回签要主动催", task: card("T4_unconfirmed", {}) },
  { rule: "F4", band: "follow", desc: "前天到的货还没入库", task: card("T7_not_stocked", { arriveDate: "2026-09-01" }) },
  { rule: "F5", band: "follow", desc: "差异不影响生产", task: card("T9_discrepancy", { coverageDays: 9 }, { demandLevel: "week", diffRatio: 0.02 }) },
  { rule: "F6", band: "follow", desc: "离最晚下单日还有几天", task: card("T1_shortage", { dueDate: "2026-09-10" }) },
  { rule: "F7", band: "follow", desc: "加单授权齐了，不急", task: card("T2_addon", { needDate: "2026-09-30", isUrgent: false }, { hasAuth: true }) },
  { rule: "F8", band: "follow", desc: "明日到货预告是固定动作", task: card("T6_notice", { promiseDate: "2026-09-04" }) },
  { rule: "F9", band: "follow", desc: "水位 4 天，在观察区", task: card("T10_daily_check", { coverageDays: 4 }, { demandLevel: "daily" }) },
  { rule: "F10", band: "follow", desc: "拦截逃逸条款：只剩 1 个工作日", task: card("T3_intercept", { dueDate: "2026-09-04" }) },
  { rule: "F11", band: "follow", desc: "付款节点还远", task: card("T13_payment", { dueDate: "2026-09-20" }) },
  // ⚪ 提醒
  { rule: "N1", band: "notice", desc: "拦截等回话，时间还宽裕", task: card("T3_intercept", { dueDate: "2026-09-30" }) },
  { rule: "N2", band: "notice", desc: "加单没拿到书面授权", task: card("T2_addon", { needDate: "2026-09-30", isUrgent: false }, { hasAuth: false }) },
  { rule: "N3", band: "notice", desc: "请购在审批流里", task: card("T1_shortage", { awaitingApproval: true }) },
  { rule: "N4", band: "notice", desc: "等数据源那边改", task: card("T14_conflict", { dueDate: BIZ }) },
  { rule: "N5", band: "notice", desc: "水位 9 天，够用", task: card("T10_daily_check", { coverageDays: 9 }, { demandLevel: "daily" }) },
  { rule: "N6", band: "notice", desc: "卡住且已升级过，今天不用再推", task: card("T10_daily_check", { editable: { blockedBy: "warehouse", escalatedTo: "仓库主管" } }) },
  { rule: "N7", band: "notice", desc: "兜底：什么都没命中也得有个家", task: card("T10_daily_check", {}) },
];

describe("28 条规则，一条一个正例（规格 §最终方案·2 三张表）", () => {
  for (const c of CASES) {
    it(`${c.rule}｜${c.desc} → ${c.band}`, () => {
      const r = bandOf(c.task, ctx);
      expect(r.ruleId).toBe(c.rule);
      expect(r.band).toBe(c.band);
      expect(r.why.length).toBeGreaterThan(6);
      expect(r.why).not.toContain("undefined");
    });
  }

  it("规则表里没有一条是「测不到的规则」——BAND_RULES 与用例表一一对上", () => {
    expect(CASES.map((c) => c.rule)).toEqual(BAND_RULES.map((r) => r.id));
  });
});

describe("自上而下短路：第一条命中即止", () => {
  it("同时满足 U2（最晚下单日到期）和 F6 的口径时，返回的是 urgent 而不是 follow", () => {
    // dueDate = 今天：U2 命中；把它当成"还没到期"读的实现会掉进 F6，这里就是那道防线
    const t = card("T1_shortage", { dueDate: BIZ, score: 60 });
    const r = bandOf(t, ctx);
    expect(r.band).toBe("urgent");
    expect(r.ruleId).toBe("U2");
  });

  it("逾期又是日配件的卡：U7 在 F2 之前命中", () => {
    const t = card("T8_overdue", { dueDate: "2026-09-01", coverageDays: 1 }, { demandLevel: "daily" });
    expect(bandOf(t, ctx).ruleId).toBe("U7");
  });

  it("在途卡承诺今天到：U5 在 F1 之前命中", () => {
    expect(bandOf(card("T5_transit", { promiseDate: BIZ }), ctx).ruleId).toBe("U5");
  });

  it("U10 优先于所有 follow / notice 规则：本该是 N1 的拦截卡被分数顶成 urgent", () => {
    const t = card("T3_intercept", { dueDate: "2026-09-30", score: 176 });
    const r = bandOf(t, ctx);
    expect(r.ruleId).toBe("U10");
    expect(r.band).toBe("urgent");
  });

  it("174.9 分不够，还是走原来的档——175 是硬线，不四舍五入", () => {
    expect(bandOf(card("T3_intercept", { dueDate: "2026-09-30", score: 174.9 }), ctx).ruleId).toBe("N1");
  });

  it("U10 命中要能让调用方留证：一句人话说清是分数顶上来的", () => {
    const t = card("T3_intercept", { dueDate: "2026-09-30", score: 176 });
    expect(u10Proof(t)).toContain("是分数把它顶上来的");
    expect(u10Proof(t)).toContain("176");
  });
});

describe("只读卡片自身字段 + bizDate（顺序才稳）", () => {
  it("同一张卡算两次结果完全一样，不受调用次数/当前时间影响", () => {
    const t = card("T9_discrepancy", { coverageDays: 2 }, { demandLevel: "week" });
    expect(bandOf(t, ctx)).toEqual(bandOf(t, ctx));
  });

  it("换个 bizDate 同一张卡可以换档：昨天的紧急今天未必紧急", () => {
    const t = card("T13_payment", { dueDate: "2026-09-04" });
    expect(bandOf(t, { bizDate: BIZ }).ruleId).toBe("U9");
    expect(bandOf(t, { bizDate: "2026-08-20" }).ruleId).toBe("F11");
  });

  it("覆盖天数缺失时不当成 0：日配水位算不出来的走兜底，不冒充紧急", () => {
    const t = card("T10_daily_check", {}, { demandLevel: "daily" });
    expect(bandOf(t, ctx).band).toBe("notice");
  });

  it("sourceRow 里没有 __bandFacts 时不炸，退保守值", () => {
    const t = card("T8_overdue", { dueDate: "2026-09-01" });
    t.sourceRow = { 订单号: "PO26-0863" };
    expect(bandFactsOf(t)).toEqual({});
    expect(bandOf(t, ctx).ruleId).toBe("F2");
  });

  it("已断料的逾期件即使不是日配也算紧急（stockedOut 口径）", () => {
    const t = card("T8_overdue", { dueDate: "2026-09-01" }, { demandLevel: "week", stockedOut: true });
    expect(bandOf(t, ctx).ruleId).toBe("U7");
  });

  it("差异卡：日配件即使比例很小也紧急（会不会影响生产才是判据）", () => {
    const t = card("T9_discrepancy", {}, { demandLevel: "daily", diffRatio: 0.01 });
    expect(bandOf(t, ctx).ruleId).toBe("U8");
  });
});
