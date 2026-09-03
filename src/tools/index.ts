// 把纯逻辑包成 pi-agent-core 的 AgentTool（TypeBox 参数 schema）。
// 原则：算账全走工具，模型只负责问清参数、解释结果；工具抛错 = 参数不全，模型据此追问。
import { Type, type Static } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { calcOrderQty } from "./calc-order-qty";
import { backwardSchedule } from "./backward-schedule";
import { formatCalc, formatSchedule } from "./format";
import { makeSaveSummaryTool } from "./save-summary";
import { makeSaveEnhancementTool } from "./save-enhancement";
import { arrivalNoticeTool, checkPoTool, lookupMaterialTool, trackStatusTool } from "./material-tools";
import { searchKnowledgeTool } from "./search-knowledge";

const CalcParams = Type.Object({
  item: Type.String({ description: "物料名称或存货编码" }),
  status: Type.Optional(Type.String({ description: "物料表里的采购状态，如 在购 / 在购-日配 / 停购-长期不买" })),
  demand: Type.Number({ description: "生产需求量" }),
  substituted: Type.Optional(Type.Number({ description: "被替代量" })),
  available: Type.Number({ description: "可用量（不是现存量，扣掉被预占的）" }),
  inTransit: Type.Optional(
    Type.Array(
      Type.Object({
        qty: Type.Number(),
        plannedDate: Type.Optional(Type.String({ description: "计划到货日 YYYY-MM-DD" })),
        overdue: Type.Optional(Type.Boolean({ description: "跟单表里已逾期未决" })),
      }),
      { description: "采购在途，逐行" },
    ),
  ),
  today: Type.Optional(Type.String({ description: "今天 YYYY-MM-DD，默认系统日期" })),
  otherWarehouses: Type.Optional(
    Type.Array(
      Type.Object({
        name: Type.String(),
        onHand: Type.Number(),
        inTransit: Type.Optional(Type.Number()),
        ownDemand: Type.Optional(Type.Number({ description: "他仓自己生产表的需求；缺了就不算调拨" })),
        safety: Type.Optional(Type.Number()),
        transferDays: Type.Optional(Type.Number({ description: "调拨运输天数" })),
      }),
      { description: "其他仓库（多仓时先算调拨）" },
    ),
  ),
  daysUntilNeed: Type.Optional(Type.Number({ description: "距需求日天数" })),
  moq: Type.Optional(Type.Number({ description: "最小起订量" })),
  packUnit: Type.Optional(Type.Number({ description: "凑整单位（一扎/一箱多少）" })),
  maxPerOrder: Type.Optional(Type.Number()),
  monthlyCapacity: Type.Optional(Type.Number()),
  batchThreshold: Type.Optional(Type.Number()),
});

export const calcOrderQtyTool: AgentTool<typeof CalcParams> = {
  name: "calc_order_qty",
  label: "下单算量",
  description:
    "下单前算净缺口：需求 − 被替代 − 可用量 − 有效在途；多仓先算调拨；缺口低于 MOQ 给三选一；按凑整单位向上取整。任何涉及「该下多少」的问题都必须先调它，不要口算。参数不全就先问用户。",
  parameters: CalcParams,
  execute: async (_id, p: Static<typeof CalcParams>) => {
    const r = calcOrderQty(p);
    return { content: [{ type: "text", text: formatCalc(r) }], details: { kind: "calc_order_qty", result: r } };
  },
};

const ScheduleParams = Type.Object({
  needDate: Type.String({ description: "车间需求日期 YYYY-MM-DD" }),
  today: Type.Optional(Type.String({ description: "今天 YYYY-MM-DD" })),
  nowTime: Type.Optional(Type.String({ description: "现在时刻 HH:mm" })),
  arrivalBufferDays: Type.Optional(Type.Number({ description: "目标到货比需求日提前几天，默认 1" })),
  transportDays: Type.Number({ description: "运输天数" }),
  productionDays: Type.Number({ description: "生产周期天数" }),
  productionCalendar: Type.Optional(
    Type.Union([Type.Literal("natural"), Type.Literal("skip_sunday"), Type.Literal("workdays")], {
      description: "生产周期口径：natural 自然日 / skip_sunday 周日不生产 / workdays 只算工作日。不知道就先问供应商",
    }),
  ),
  sampleDays: Type.Optional(Type.Number({ description: "新品打样天数" })),
  orderCutoff: Type.Optional(Type.String({ description: "供应商接单截止时刻 HH:mm" })),
  shipWeekdays: Type.Optional(Type.Array(Type.Number(), { description: "固定发车日 0=周日…6=周六，空=天天发" })),
  receivingWeekdays: Type.Optional(Type.Array(Type.Number(), { description: "仓库可收货星期，默认 1-5" })),
  receivingUntil: Type.Optional(Type.String({ description: "仓库收货截止 HH:mm" })),
  supplierArrivalTime: Type.Optional(Type.String({ description: "供应商货一般几点到 HH:mm" })),
  onTimeGrade: Type.Optional(Type.Union([Type.Literal("normal"), Type.Literal("poor")], { description: "准交表现" })),
  season: Type.Optional(Type.Union([Type.Literal("normal"), Type.Literal("peak")], { description: "雨季/大促季填 peak" })),
  supplierShutdown: Type.Optional(Type.Array(Type.Object({ from: Type.String(), to: Type.String() }), { description: "供应商停产期" })),
  expediteProductionDays: Type.Optional(Type.Number({ description: "加急生产天数" })),
});

export const backwardScheduleTool: AgentTool<typeof ScheduleParams> = {
  name: "backward_schedule",
  label: "交期倒推",
  description:
    "算最晚下单日：目标到货（对齐收货日）− 运输 − 生产周期（按口径跳周日/节假日、对齐发车日）− 接单截止修正 − 安全缓冲。来不及时给加急和改计划两条路。涉及「什么时候下单 / 来不来得及」必须调它。",
  parameters: ScheduleParams,
  execute: async (_id, p: Static<typeof ScheduleParams>) => {
    const r = backwardSchedule(p);
    return { content: [{ type: "text", text: formatSchedule(r) }], details: { kind: "backward_schedule", result: r } };
  },
};

export interface ToolContext {
  sessionId: string;
}

/** 当前可用的全部工具（其余工具在各自模块就位后接入） */
export function buildTools(ctx: ToolContext): AgentTool<any>[] {
  return [
    searchKnowledgeTool,
    lookupMaterialTool,
    calcOrderQtyTool,
    backwardScheduleTool,
    checkPoTool,
    arrivalNoticeTool,
    trackStatusTool,
    makeSaveSummaryTool(ctx.sessionId),
    makeSaveEnhancementTool(ctx.sessionId),
  ];
}
