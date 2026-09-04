// 卡片 ↔ 教程的唯一桥。规格：DESIGN-workbench-v2 §4.3「与 21 篇教程的联动」。
//
// 两条不能破的规矩：
// ① **映射手写，不做算法推荐**。哪一篇是主教程是产品判断（比如下单卡挂 net-requirement 而不是
//    po-essentials——她在下单卡上最容易错的不是"订单写哪九项"，是"这个数算对没有"）。
// ② **可信度只能取真实数据**。confidence 一律从 tutorial/content.ts 现算，这里绝不手抄；
//    unknown 档**不印任何路径**（path 必为空串），改印「找谁问 + 开口第一句」——
//    印一条错路径比不印更坏（§4.1 三态三形）。
import type { TaskKind, U8PathRef } from "../board/types";
import { OPEN_QUESTIONS, TUTORIALS, type Stage as TutorialStage, type Tutorial } from "./content";

/** §4.3 主通道：一类任务一篇主教程（13 类，一条不落） */
export const TUTORIAL_OF: Record<TaskKind, string> = {
  T1_shortage: "net-requirement",
  T1B_late: "net-requirement",
  T2_addon: "po-essentials",
  T3_intercept: "order-change",
  T4_unconfirmed: "confirm-signback",
  T5_transit: "po-exec-stat",
  T6_notice: "receive-checklist",
  T7_not_stocked: "po-instock-query",
  T8_overdue: "chase-playbook",
  T9_discrepancy: "receive-checklist",
  T10_daily_check: "qty-basics",
  T13_payment: "settle-reconcile",
  T14_conflict: "import-archive",
};

/** §4.3 主通道表的「旁支」列，平级参考，不抢主教程的位置 */
export const RELATED_OF: Record<TaskKind, string[]> = {
  T1_shortage: ["po-essentials", "stock-query"],
  T1B_late: ["chase-playbook"],
  T2_addon: ["order-change"],
  T3_intercept: ["qty-basics"],
  T4_unconfirmed: ["po-query"],
  T5_transit: ["in-transit-scopes"],
  T6_notice: ["po-exec-stat"],
  T7_not_stocked: ["flow-standard"],
  T8_overdue: ["po-exec-stat"],
  T9_discrepancy: ["flow-return"],
  T10_daily_check: ["stock-query"],
  T13_payment: ["flow-provision"],
  T14_conflict: ["stock-query"],
};

/** §4.3 辅通道：教程 stage → 泳道分组。settle/basics 不进泳道 */
export const LANE_OF_TUTORIAL_STAGE: Record<TutorialStage, "demand" | "to_order" | "transit" | "inbound" | "checklist" | "always"> = {
  plan: "demand",
  order: "to_order",
  confirm: "to_order",
  track: "transit",
  receive: "inbound",
  settle: "checklist",
  basics: "always",
};

/**
 * 每类任务「主操作那一步」的 U8 落点，指向某篇教程里的某一步（用 where 原文比对，不另抄一份路径）。
 * null = 这类卡的主操作压根不在 U8 里（打电话 / 要书面 / 记一笔），不该印路径条。
 * 只挑**语义对得上**的落点：宁可 null，也不拿一条相近的菜单去凑。
 */
const U8_ANCHOR: Record<TaskKind, { tutorialId: string; match: RegExp } | null> = {
  T1_shortage: { tutorialId: "po-query", match: /采购订单/ },      // 开单就在这个节点下
  T1B_late: null,                                                   // 要的是领导/生产一句书面结论
  T2_addon: { tutorialId: "po-query", match: /采购订单/ },          // 加单也是新开一张 PO
  T3_intercept: null,                                               // 等提出人回话
  T4_unconfirmed: null,                                             // 回签在微信/邮件里要
  T5_transit: { tutorialId: "po-exec-stat", match: /执行统计表/ },
  T6_notice: null,                                                  // 预告发仓库群
  T7_not_stocked: { tutorialId: "po-instock-query", match: /采购入库单/ },
  T8_overdue: null,                                                 // 催货是电话
  T9_discrepancy: null,                                             // 定性是判断，落点在两边的书面记录
  T10_daily_check: { tutorialId: "stock-query", match: /现存量查询/ },
  T13_payment: null,                                                // 催付款是找财务/供应商说话
  T14_conflict: { tutorialId: "import-archive", match: /数据导入/ },
};

/** unknown 档兜底问谁：没有落点时用哪条待核问题的话术（默认问菜单树那条） */
const OPEN_QUESTION_OF: Partial<Record<TaskKind, string>> = {
  T7_not_stocked: "oq-instock-group",
  T5_transit: "oq-report-groups",
  T10_daily_check: "oq-stock-query-parent",
  T14_conflict: "oq-implementation-nav-exists",
  T13_payment: "oq-po-menu-children",
};
const DEFAULT_OPEN_QUESTION = "oq-po-menu-children";

const findTutorialById = (id: string): Tutorial | undefined => TUTORIALS.find((t) => t.id === id);

/** unknown 档的 askScript：找谁问 + 开口第一句 + 自己核的办法（原文取自 OPEN_QUESTIONS[].howToVerify） */
function askScriptOf(openQuestionId: string): string {
  const q = OPEN_QUESTIONS.find((o) => o.id === openQuestionId) ?? OPEN_QUESTIONS[0];
  return `问老采购一句：「X 姐，${q.question}我截个图记一下。」自己核也行：${q.howToVerify}`;
}

/** unknown 档：**不印路径**（path 必为空串），只给问谁 + 开口第一句 */
function unknownRef(kind: TaskKind): U8PathRef {
  const openQuestionId = OPEN_QUESTION_OF[kind] ?? DEFAULT_OPEN_QUESTION;
  return { path: "", confidence: "unknown", openQuestionId, askScript: askScriptOf(openQuestionId) };
}

/**
 * 这类卡主操作的 U8 路径引用。**路径与可信度都来自 content.ts 的真实教程步骤**，
 * 落点缺失或那一步本身是 unknown → 退回 unknown 档（空路径 + 问谁 + 开口第一句）。
 */
export function u8RefFor(kind: TaskKind): U8PathRef {
  const anchor = U8_ANCHOR[kind];
  if (!anchor) return unknownRef(kind);
  const t = findTutorialById(anchor.tutorialId);
  const step = t?.steps.find((s) => !!s.where && anchor.match.test(s.where));
  if (!step?.where || step.confidence === "unknown") return unknownRef(kind);
  return { path: step.where, confidence: step.confidence };
}

/**
 * 卡片上 `[看图文 ›]` 点开什么。教程整篇 confidence = unknown 时不给链接，
 * 改给待核问题——把她引到一篇同样说不清的文章里，比不给链接更伤信任（§4.3 兜底）。
 */
export function tutorialLinkFor(kind: TaskKind): { kind: "tutorial"; id: string } | { kind: "openQuestion"; id: string } {
  const id = TUTORIAL_OF[kind];
  const t = findTutorialById(id);
  if (!t || t.confidence === "unknown") return { kind: "openQuestion", id: OPEN_QUESTION_OF[kind] ?? DEFAULT_OPEN_QUESTION };
  return { kind: "tutorial", id };
}
