// 当日收工判定（采姐 spec-cai.md §4 八条 + 苏姐 §3.5 的完成态）。
//
// 采姐那句话是这一整个模块的判据：**允许「未闭环」，不允许「没交代」。**
// 所以每条自动项的判定都是「该类卡要么干完了，要么写清了卡在谁那里」，
// 而不是「卡片必须清零」——采购这行没有事事当天办完的。
//
// handoverText 是直接复制发给领导的三句话：做了什么 / 卡在哪 / 明天要什么，带具体数字。
import { rankTasks } from "./rules";
import { DAY_CHECKLIST_ITEMS, type BoardTask, type TaskKind } from "./types";

export interface DayItem {
  id: string;
  text: string;
  auto?: boolean;
  satisfied: boolean;
  detail?: string;
}
export interface DayResult {
  items: DayItem[];
  canClose: boolean;
  handoverText: string;
}

/**
 * **完成 = 程序判定**（v2）：主操作那 1~2 格必填凭据都填齐了，就算干完，不再看她勾了几个步骤。
 * 勾步骤是给她自己看的过程，凭据才是当天可验证的客观事实（订单号、回签日、新交期、谁回的收到）。
 */
export function evidenceDone(t: BoardTask): boolean {
  const req = (t.primaryAction?.evidence ?? []).filter((e) => e.required);
  if (req.length === 0) return false;
  const got = t.doneEvidence ?? {};
  return req.every((e) => String(got[e.key] ?? "").trim() !== "");
}
/** 干完了 = 凭据填齐 或 状态已被置成 done（两条都认，落库的老卡不至于回退） */
const isDone = (t: BoardTask) => t.status === "done" || evidenceDone(t);
const isClosed = (t: BoardTask) => isDone(t) || t.status === "dropped";
/** 「有交代」= 写了卡在谁那里 / 明天几点动它。空备注不算交代。 */
const hasNote = (t: BoardTask) => !!(t.note && t.note.trim().length >= 2);
/** 「今天动过」= 推到 doing / 记过一笔 / 凭据填了一半（催了但对方没回，不是她的错） */
const acted = (t: BoardTask) =>
  t.status === "doing" || (t.events?.length ?? 0) > 0 || Object.values(t.doneEvidence ?? {}).some((v) => String(v ?? "").trim() !== "");

const nameOf = (t: BoardTask) => t.materialName || t.materialCode || t.poNo || t.title;

/** 某一类卡：全部闭环，或未闭环的都写了交代 */
function settled(tasks: BoardTask[], kinds: TaskKind[], opts?: { actedIsEnough?: boolean }) {
  const mine = tasks.filter((t) => kinds.includes(t.kind) && t.status !== "dropped");
  const open = mine.filter((t) => !isClosed(t) && !hasNote(t) && !(opts?.actedIsEnough && acted(t)));
  return { total: mine.length, done: mine.filter(isDone).length, open };
}

export function evaluateDay(tasks: BoardTask[], checklist: Record<string, boolean>, bizDate: string): DayResult {
  const live = tasks.filter((t) => t.bizDate === bizDate || !t.bizDate);
  const items: DayItem[] = [];

  const push = (id: string, satisfied: boolean, detail: string) => {
    const def = DAY_CHECKLIST_ITEMS.find((d) => d.id === id)!;
    // 她手动勾上的一律尊重——系统判不出来的事（比如她在电话里已经交代过了）不能拦着她收工
    const manual = checklist[id] === true;
    items.push({ id, text: def.text, auto: def.auto, satisfied: def.auto ? satisfied || manual : manual, detail });
  };

  // 1 日配水位
  const water = live.filter((t) => t.kind === "T10_daily_check");
  const waterOpen = water.filter((t) => !isClosed(t) && !hasNote(t));
  // 没有日配巡检卡时判「满足」而不是「不满足」：厂里可能压根没有日配件品类，或物料表还没标。
  // 原先判不满足会让这类团队永远收不了工——一条提醒不该变成一道锁（补测发现，2026-09-03 改）。
  push("daily_water", waterOpen.length === 0,
    water.length === 0
      ? "今天没有日配巡检卡——如果厂里有日配件，去物料表把「在购-日配」标上；没有就跳过这项"
      : waterOpen.length === 0
        ? `${water.length} 件日配水位都录了`
        : `还差 ${waterOpen.length} 件没录水位：${waterOpen.map(nameOf).join("、")}`);

  // 2 该下的单
  const order = settled(live, ["T1_shortage", "T1B_late"]);
  push("shortage_cleared", order.open.length === 0,
    order.total === 0 ? "今天没有要下的单" :
      order.open.length === 0 ? `${order.total} 张要下的单：${order.done} 张已下单，其余都写清了原因`
        : `${order.open.length} 张既没下也没写原因：${order.open.map(nameOf).join("、")}——不下可以，得写清卡在谁那里、明天几点动`);

  // 3 加单授权
  const addon = settled(live, ["T2_addon"]);
  push("addon_logged", addon.open.length === 0,
    addon.total === 0 ? "今天没有加单" :
      addon.open.length === 0 ? `${addon.total} 条加单都处理了（有凭据的已下，没凭据的已退回）`
        : `${addon.open.length} 条加单悬着：${addon.open.map(nameOf).join("、")}——没书面授权就回一句退回去，别拖着`);

  // 4 未回签的催过一轮（这一条 acted 就算数：催了但对方没回不是她的错）
  const confirm = settled(live, ["T4_unconfirmed"], { actedIsEnough: true });
  push("confirm_chased", confirm.open.length === 0,
    confirm.total === 0 ? "没有等回签的单" :
      confirm.open.length === 0 ? `${confirm.total} 张未回签的都催过了`
        : `${confirm.open.length} 张还没催：${confirm.open.map(nameOf).join("、")}——发出去 48 小时没回签就该换轨发邮件抄送了`);

  // 5 逾期件已通知生产
  const overdue = settled(live, ["T8_overdue"]);
  push("overdue_escalated", overdue.open.length === 0,
    overdue.total === 0 ? "今天没有逾期件" :
      overdue.open.length === 0 ? `${overdue.total} 条逾期都拿到新交期或已书面告知生产`
        : `${overdue.open.length} 条逾期没交代：${overdue.open.map(nameOf).join("、")}——只打电话没通知生产 = 没做完`);

  // 6 到货预告（这条只认闭环：仓库回执是硬指标）
  const notice = live.filter((t) => t.kind === "T6_notice");
  const noticeDone = notice.every((t) => isClosed(t));
  push("notice_sent", notice.length === 0 || noticeDone,
    notice.length === 0 ? "明天没有承诺到货的单，不用发预告"
      : noticeDone ? "预告已发，仓库已回执" : "预告还没发或仓库还没回——没人回 = 没发出，17:00 没人回就打电话");

  // 7 差异件
  const disc = settled(live, ["T9_discrepancy", "T7_not_stocked"]);
  push("discrepancy_filed", disc.open.length === 0,
    disc.total === 0 ? "今天没有差异 / 到货未入库" :
      disc.open.length === 0 ? `${disc.total} 条差异都登记并通知了两边`
        : `${disc.open.length} 条还没定性：${disc.open.map(nameOf).join("、")}——拖过三天就说不清了`);

  // 8 收工三句话（只能她自己发，系统不替她按对外的按钮）
  push("handover", false, "三句话已经写好了，复制发出去再勾——小采不替你按对外的按钮");

  const canClose = items.every((i) => i.satisfied);
  return { items, canClose, handoverText: handoverText(live, bizDate) };
}

/** 收工三句话：做了什么 / 卡在哪 / 明天要什么。带具体数字，写得像人写的。 */
export function handoverText(tasks: BoardTask[], bizDate: string): string {
  const [, m, d] = bizDate.split("-");
  const day = `${Number(m)}/${Number(d)}`;
  const done = tasks.filter(isDone);
  const stuck = tasks.filter((t) => !isDone(t) && t.status !== "dropped");

  // 句一：做成了什么
  const orderedCnt = done.filter((t) => t.kind === "T1_shortage" || t.kind === "T2_addon").length;
  const savedCnt = done.filter((t) => t.kind === "T8_overdue" || t.kind === "T10_daily_check").length;
  const noticeCnt = done.filter((t) => t.kind === "T6_notice").length;
  const first: string[] = [];
  if (orderedCnt) first.push(`下了 ${orderedCnt} 张单（${done.filter((t) => t.kind === "T1_shortage" || t.kind === "T2_addon").slice(0, 3).map(nameOf).join("、")}）`);
  if (savedCnt) first.push(`拦下 ${savedCnt} 处可能断料的（${done.filter((t) => t.kind === "T8_overdue" || t.kind === "T10_daily_check").slice(0, 3).map(nameOf).join("、")}）`);
  if (noticeCnt) first.push("明天的到货预告已经发给仓库了");
  const s1 = first.length ? `X 总，${day} 我这边：${first.join("；")}。` : (tasks.length
        ? `X 总，${day} 我这边今天没有已闭环的事项，手上 ${tasks.length} 条都还在推进中。`
        : `X 总，${day} 我这边今天没有新的采购动作要收口。`);

  // 句二：卡在哪（点名 + 卡在谁那里）
  const top = rankTasks(stuck).ordered.slice(0, 3);
  const s2 = top.length
    ? `还卡着 ${stuck.length} 条，最要紧的是：${top.map((t) => `${nameOf(t)}${t.note ? `（${t.note.trim()}）` : t.supplier ? `（等 ${t.supplier} 回话）` : ""}`).join("；")}。`
    : "今天的事都闭环了，没有挂着的。";

  // 句三：明天要什么（要拍板的 / 明早第一件事）
  const needBoss = stuck.filter((t) => t.kind === "T1B_late" || t.kind === "T9_discrepancy");
  const s3 = needBoss.length
    ? `明天要您拍一下板的是：${needBoss.slice(0, 2).map((t) => `${nameOf(t)}${t.kind === "T1B_late" ? "（走加急加钱，还是让生产挪计划）" : "（差异是补货还是退回）"}`).join("；")}，您给个方向我照办。`
    : top.length
      ? `明天一早我先追${nameOf(top[0])}这条，有结果第一时间跟您说。`
      : "明天按计划走，有异常我随时跟您报。";

  return `${s1}${s2}${s3}`;
}
