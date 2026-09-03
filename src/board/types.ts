// 看板的共享类型。这份由老架定稿，工兵各自实现自己那半边，谁都不改它——
// 逻辑侧（score/generate/rules）与界面侧（BoardView）只通过这里对齐。
// 业务定义出自采姐规格 spec-cai.md §2/§3/§6，交互约束出自苏姐规格 spec-su.md §3/§4。

/** 四条泳道。苏姐定的硬约束：一张卡只能有一个家，不设第五条「救火」泳道（救火走顶部横幅）。 */
export type Stage = "order" | "confirm" | "transit" | "inbound";

export const STAGES: { id: Stage; name: string; hint: string }[] = [
  { id: "order", name: "要下单", hint: "缺料 / 加单 / 日配水位，今天不下单就来不及" },
  { id: "confirm", name: "等确认", hint: "单发出去了，供应商还没回签数量和交期" },
  { id: "transit", name: "在途催货", hint: "已确认未到货，盯发运与到期" },
  { id: "inbound", name: "到货入库", hint: "到了没入库、数量对不上、要跟仓库和品质对接" },
];

/** 12 类任务（采姐 §2）。T11 对账 / T12 汇报不进泳道，落在当日收工清单里。 */
export type TaskKind =
  | "T1_shortage"      // 缺料下单
  | "T1B_late"         // 下单已来不及，要的是补救不是下单
  | "T2_addon"         // 当日加单
  | "T3_intercept"     // 拦截确认（停购/下架/替代料）
  | "T4_unconfirmed"   // 下单后未回签
  | "T5_transit"       // 在途跟踪
  | "T6_notice"        // 明日到货预告
  | "T7_not_stocked"   // 到货未入库
  | "T8_overdue"       // 逾期催货
  | "T9_discrepancy"   // 数量/质量差异
  | "T10_daily_check"; // 日配件水位巡检

export type TaskStatus = "todo" | "doing" | "done" | "dropped";

/** 打分因子的原始输入。字段来源见采姐 §6 数据字段清单；缺字段一律给保守值，不猜。 */
export interface ScoreInput {
  /** 距最晚动作日的工作日数，负数=已逾期 */
  workdaysLeft: number;
  /** 断线等级：daily=日配件 week=本周排产 next=下周排产 refill=安全库存补货 */
  demandLevel: "daily" | "week" | "next" | "refill";
  /** 是否已经断料（现场停线或即将停线） */
  stockedOut?: boolean;
  /** 卡在谁那里：none/warehouse/finance/production */
  blockedBy?: "none" | "warehouse" | "finance" | "production";
  /** 金额（元），只占很小权重——纠正新人「金额大先做」的直觉 */
  amount?: number;
  /** 供应商历史准时率 0~1，缺省按 0.8 */
  onTimeRate?: number;
  /** 这条任务已经躺了几天，防止被永久冷落 */
  ageDays?: number;
  /** 5 分钟内能干完的快赢 */
  quickWin?: boolean;
}

export interface ScoreBreakdown {
  score: number;
  level: "P0" | "P1" | "P2" | "P3";
  /** 每个因子的得分明细，直接渲染成「为什么排第一」 */
  factors: { key: string; label: string; weight: number; value: number; points: number; why: string }[];
  /** 命中的硬规则 */
  rules: string[];
}

/** 一步动作。苏姐铁律④：每张卡必须答「什么算干完」。 */
export interface TaskStep {
  id: string;
  text: string;
  /** 这一步在哪儿做：U8 菜单 / 打电话 / 找人 / 小采工具 */
  where?: string;
}

export interface BoardTask {
  id: string;
  kind: TaskKind;
  stage: Stage;
  status: TaskStatus;
  title: string;               // 动作式标题，动词开头
  materialCode?: string;
  materialName?: string;
  supplier?: string;
  poNo?: string;
  qty?: number;
  needDate?: string;           // 需求日期 YYYY-MM-DD
  promiseDate?: string;        // 供应商回签的承诺到货日
  dueDate?: string;            // 最晚动作日（四个 stage 各有定义）
  score: number;
  reasons: string[];           // 打分因子的人话版本
  steps: TaskStep[];
  doneSteps: string[];         // 已勾选的 step id
  doneRule: string;            // 完成判定：当天可验证的客观事实
  escalation?: string;         // 卡住了找谁 + 开口第一句
  sourceRow?: Record<string, unknown>; // 来源数据行，用于「这数从哪来的」
  note?: string;
  bizDate: string;             // 归属业务日 YYYY-MM-DD
  createdAt: number;
  updatedAt: number;
  closedAt?: number | null;
}

/** 当日收工清单（采姐 §4）。允许「未闭环」，不允许「没交代」。 */
export interface DayChecklist {
  [itemId: string]: boolean;
}
export interface BoardDay {
  bizDate: string;
  checklist: DayChecklist;
  closedAt?: number | null;
  note?: string | null;
}

export const DAY_CHECKLIST_ITEMS: { id: string; text: string; auto?: boolean }[] = [
  { id: "daily_water", text: "日配件水位巡检做过两次（早/午）", auto: true },
  { id: "shortage_cleared", text: "今天该下的单都下了，下不了的写明原因", auto: true },
  { id: "addon_logged", text: "当日加单全部有授权凭据，没凭据的已退回", auto: true },
  { id: "confirm_chased", text: "未回签的单都催过一轮，有回复或有下一步时间点", auto: true },
  { id: "overdue_escalated", text: "逾期件已通知生产，生产知道最新到货时间", auto: true },
  { id: "notice_sent", text: "明日到货预告已发仓库并拿到回执", auto: true },
  { id: "discrepancy_filed", text: "差异件已登记并告知品质/仓库", auto: true },
  { id: "handover", text: "收工三句话已发（做了什么 / 卡在哪 / 明天要什么）" },
];
