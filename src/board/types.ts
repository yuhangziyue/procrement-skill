// 看板的共享类型。这份由老架定稿，工兵各自实现自己那半边，谁都不改它——
// 逻辑侧（score/generate/rules）与界面侧（BoardView）只通过这里对齐。
// 业务定义出自采姐规格 spec-cai.md §2/§3/§6，交互约束出自苏姐规格 spec-su.md §3/§4。

/**
 * 四条泳道（v2）。划分判据是**现在是谁在动**，不是任务处在哪个系统状态——
 * 她一眼要看出来"这事该我推，还是我在等别人"。
 * 「等确认」泳道取消并入「待下单」：回签前订单只是一厢情愿（SOP 03 + 口诀「无签不认」），
 * 放进在途她会把它当有效在途去扣净缺口，那正是盲区清单里的第 2 条。
 */
export type Stage = "demand" | "to_order" | "transit" | "inbound";

export const STAGES: { id: Stage; name: string; hint: string; owner: string }[] = [
  { id: "demand", name: "需求", hint: "买不买 / 买哪个编码 / 买多少 / 还来不来得及 —— 还有一问没定", owner: "生产·计划·领导在动" },
  { id: "to_order", name: "待下单", hint: "从算完净缺口到拿到书面回签。回签前，这单没下完", owner: "你在动" },
  { id: "transit", name: "在途", hint: "已回签未到货，盯发运与到期", owner: "供应商·物流在动" },
  { id: "inbound", name: "入库", hint: "到了没入库、数量对不上、要跟仓库和品质对接", owner: "仓库·质检在动" },
];

/**
 * 三档。用户要的「紧急 / 日常跟进 / 提醒」。
 * 与 score 各管一件事：**band 决定这张卡是什么性质（分区），score 决定同档内谁先做（排序）**。
 * 两者冲突时 band 赢——分数是实现细节，性质是给人看的。
 */
export type Band = "urgent" | "follow" | "notice";
export const BANDS: { id: Band; name: string; hint: string }[] = [
  { id: "urgent", name: "紧急", hint: "今天不动，明天就是事故" },
  { id: "follow", name: "日常跟进", hint: "今天有一个动作就行，不要求闭环" },
  { id: "notice", name: "提醒", hint: "我推出去了，等别人回话" },
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
  | "T10_daily_check"  // 日配件水位巡检
  | "T13_payment"      // 催付款 / 催开票（付款或开票节点 ≤ 明天才生成）
  | "T14_conflict";    // 判断层与事实层冲突，去改数据源

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

/** U8 路径引用。可信度不足时**不印路径**，改印"找谁问 + 开口第一句"——印一条错路径比不印更坏。 */
export interface U8PathRef {
  path: string;
  confidence: "verified" | "unverified" | "unknown";
  /** unknown 时必填，指向 tutorial/content.ts 的 OPEN_QUESTIONS[].id */
  openQuestionId?: string;
  /** unknown 时必填：找谁问 + 开口第一句 */
  askScript?: string;
}

/**
 * 一步动作。`role` 是 v2 新增的硬约束：
 * gate = 不勾完主操作按钮点不动（把"别跳步"从自觉变成物理约束），每卡最多 2 条；hint = 参考。
 */
export interface TaskStep {
  id: string;
  text: string;
  role: "gate" | "hint";
  /** 这一步在哪儿做：U8 菜单 / 打电话 / 找人 / 小采工具 */
  where?: string;
  u8Path?: U8PathRef;
  /** MOQ 三选一这类：给选项 + 每个选项的后果，不让她自己权衡 */
  choices?: { id: string; text: string; consequence: string }[];
}

/** 主操作：一张卡只有一个动词。点它要填 1~2 格凭据，填齐才算做完（完成改为程序判定）。 */
export interface PrimaryAction {
  id: string;
  label: string;
  actionKind: "u8" | "call" | "message" | "record" | "decide";
  /** 只有这一条路径会印在折叠态卡面上，避免菜单路径变噪音 */
  u8Path?: U8PathRef;
  evidence: EvidenceField[];
}
export interface EvidenceField {
  key: string;
  label: string;
  type: "text" | "date" | "checkbox" | "select";
  required: boolean;
  options?: string[];
}

/**
 * 可写字段 = 判断层 + 过程层。**事实层（数量、金额、单据状态）永远不在这里**：
 * 小采不能变成第二套账去和 U8 打架。
 * 日期的判据是「谁承诺的日期，拿到那个人的承诺才能写」——所以 needDate 只读，promiseDate 可写。
 */
export interface EditableFields {
  note?: string;
  materialCodeFix?: string;
  supplierOverride?: string;
  promiseDate?: string;
  /** 只有 signback（书面回签）参与打分——用产品机制教会她「口头不算」 */
  promiseSource?: "signback" | "verbal" | "guess";
  etaDate?: string;
  trackingNo?: string;
  nextActionAt?: string;
  blockedBy?: "none" | "warehouse" | "finance" | "production" | "supplier";
  escalatedTo?: string;
}

/** 跟进记录：谁、什么时候、通过什么渠道、说了什么。留痕是采购的命。 */
export interface TaskEvent {
  id: string;
  taskId: string;
  at: string;
  channel: "电话" | "微信" | "邮件" | "当面" | "系统";
  counterpart?: string;
  content: string;
  newPromiseDate?: string;
}

export interface BoardTask {
  id: string;
  kind: TaskKind;
  stage: Stage;
  /** 三档，由 bandOf() 算出；bandRule 是命中的规则 id，bandWhy 是给人看的一句话 */
  band: Band;
  bandRule: string;
  bandWhy: string;
  primaryAction: PrimaryAction;
  editable: EditableFields;
  events: TaskEvent[];
  /** primaryAction.evidence 的填写结果，填齐即完成 */
  doneEvidence?: Record<string, string>;
  tutorialId?: string;
  awaitingApproval?: boolean;
  isUrgent?: boolean;
  /** 落库而不是每次现算：band 判定与卡面都要用 */
  coverageDays?: number;
  arriveDate?: string;
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
