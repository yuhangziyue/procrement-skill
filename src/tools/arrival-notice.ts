// 明日到货预告（04 第一步的程序化版本）。
// 从跟单表筛「承诺交期 = 明天（或指定日）」且未完结的行，产出给仓库的六列到货计划 + 可直接复制的 markdown 表 + 一句开口话术。
// 不碰 IO / DOM / db。急料 / 需先检 从「跟进记录 / 备注」里含「急」「检」判断。
import { diffDays, fmtLoose, fmtLooseCn, isClosedStatus, parseLoose, pickField, type TrackingRow } from "./track-status";

export interface ArrivalNoticeOptions {
  /** 指定预告哪天到的货（YYYY-MM-DD，宽松格式也行）。默认 today + 1 */
  targetDate?: string;
}

/** 04 第一步六列表的一行（英文键，中文标签见 ARRIVAL_COLUMNS） */
export interface ArrivalLine {
  /** 订单号 */
  orderNo: string;
  /** 供应商 */
  supplier: string;
  /** 物料编码/名称 */
  material: string;
  /** 数量 */
  qty: string;
  /** 预计到达时间 */
  eta: string;
  /** 备注（急料/需先检/物流单号） */
  note: string;
  urgent: boolean;
  needInspection: boolean;
  row: TrackingRow;
}

/** 六列的中文表头，顺序与 04 第一步一致 */
export const ARRIVAL_COLUMNS: { key: keyof Pick<ArrivalLine, "orderNo" | "supplier" | "material" | "qty" | "eta" | "note">; label: string }[] = [
  { key: "orderNo", label: "订单号" },
  { key: "supplier", label: "供应商" },
  { key: "material", label: "物料编码/名称" },
  { key: "qty", label: "数量" },
  { key: "eta", label: "预计到达时间" },
  { key: "note", label: "备注（急料/需先检）" },
];

export interface ArrivalNoticeResult {
  today: string;
  /** 预告的到货日 YYYY-MM-DD */
  targetDate: string;
  lines: ArrivalLine[];
  /** 被跳过的行及原因（完结 / 交期不是目标日 / 交期解析不了） */
  skipped: { orderNo: string; reason: string }[];
  headline: string;
  /** 直接复制发仓库的 markdown 六列表 */
  markdown: string;
  /** 给仓库的开口话术（微信/邮件正文） */
  message: string;
  flags: string[];
}

export function arrivalNotice(rows: TrackingRow[], today: string, options: ArrivalNoticeOptions = {}): ArrivalNoticeResult {
  const todayDate = parseLoose(today);
  if (!todayDate) throw new Error(`today 日期格式无法解析，收到「${today}」`);
  const todayStr = fmtLoose(todayDate);

  let target: Date;
  if (options.targetDate) {
    const t = parseLoose(options.targetDate);
    if (!t) throw new Error(`targetDate 日期格式无法解析，收到「${options.targetDate}」`);
    target = t;
  } else {
    target = new Date(todayDate);
    target.setUTCDate(target.getUTCDate() + 1);
  }
  const targetStr = fmtLoose(target);
  const flags: string[] = [];
  const lines: ArrivalLine[] = [];
  const skipped: ArrivalNoticeResult["skipped"] = [];

  for (const row of rows) {
    const orderNo = pickField(row, ["订单号", "采购订单号", "PO"]);
    const status = pickField(row, ["状态"]);
    const rawDue = pickField(row, ["承诺交期", "计划到货日期", "交期"]);
    const due = parseLoose(rawDue);

    if (isClosedStatus(status)) { skipped.push({ orderNo, reason: `状态「${status}」已完结` }); continue; }
    if (!due) { skipped.push({ orderNo, reason: rawDue ? `承诺交期「${rawDue}」解析不了，先补成 YYYY-MM-DD` : "承诺交期为空" }); continue; }
    if (fmtLoose(due) !== targetStr) { skipped.push({ orderNo, reason: `承诺交期 ${fmtLoose(due)} ≠ ${targetStr}` }); continue; }

    const code = pickField(row, ["物料编码", "存货编码", "编码"]);
    const name = pickField(row, ["物料名称", "存货名称", "物料", "名称"]);
    const supplier = pickField(row, ["供应商", "供应商名称"]);
    const qty = pickField(row, ["数量", "订单数量"]);
    const tracking = pickField(row, ["物流单号"]);
    const etaCol = pickField(row, ["预计到达时间", "预计到达"]);
    const remarkText = [pickField(row, ["跟进记录"]), pickField(row, ["备注"])].filter(Boolean).join(" ");

    const urgent = /急/.test(remarkText);
    const needInspection = /检/.test(remarkText);
    const notes: string[] = [];
    if (urgent) notes.push("急料，到了优先点数");
    if (needInspection) notes.push("需先检，合格后再入库");
    if (tracking) notes.push(`物流单号 ${tracking}`);
    else if (status === "未发货") notes.push("供应商尚未报发货，到达时刻待确认");

    const etaText = etaCol || `${targetStr} 当天${status === "已发货在途" ? "（已发货）" : "（具体时刻向供应商确认）"}`;

    lines.push({
      orderNo, supplier, material: [code, name].filter(Boolean).join(" "), qty,
      eta: etaText, note: notes.join("；"), urgent, needInspection, row,
    });
  }

  const unshipped = lines.filter((l) => l.row["状态"]?.trim() === "未发货");
  if (unshipped.length) flags.push(`${unshipped.length} 单明天到但状态还是「未发货」：今天先向供应商要运单号，要不到就把预告标成「待确认」`);
  const noTracking = lines.filter((l) => !pickField(l.row, ["物流单号"]));
  if (noTracking.length && !unshipped.length) flags.push(`${noTracking.length} 单没有物流单号，给仓库前先向供应商要`);
  if (lines.some((l) => l.needInspection)) flags.push("有需先检的料：提前通知质检，检验合格才能入库（04 第二步 3）");

  const d = diffDays(todayDate, target);
  const dayWord = d === 1 ? "明天" : d === 0 ? "今天" : d === 2 ? "后天" : `${targetStr}`;
  const headline = rows.length === 0
    ? `跟单表是空的：${dayWord}（${fmtLooseCn(target)}）没有可预告的到货`
    : lines.length === 0
      ? `${dayWord}（${fmtLooseCn(target)}）没有承诺到货的订单行，不用发预告（共看了 ${rows.length} 行）`
      : `${dayWord}（${fmtLooseCn(target)}）预计到货 ${lines.length} 单${lines.some((l) => l.urgent) ? `，其中 ${lines.filter((l) => l.urgent).length} 单急料` : ""}：下班前把下面这张表发给仓库`;

  const esc = (s: string) => s.replace(/\|/g, "／").replace(/\r?\n/g, " ");
  const header = `| ${ARRIVAL_COLUMNS.map((c) => c.label).join(" | ")} |\n|${ARRIVAL_COLUMNS.map(() => "---").join("|")}|`;
  const body = lines.map((l) => `| ${ARRIVAL_COLUMNS.map((c) => esc(l[c.key])).join(" | ")} |`).join("\n");
  const markdown = lines.length ? `${header}\n${body}` : `_（${targetStr} 无到货）_`;

  const message = lines.length
    ? `仓库好，${dayWord}（${fmtLooseCn(target)}）预计到货 ${lines.length} 单，明细如下，请安排收货：\n${lines.map((l, i) => `${i + 1}. ${l.orderNo} ${l.supplier} ${l.material} ${l.qty}${l.note ? `（${l.note}）` : ""}`).join("\n")}\n` +
      `${lines.some((l) => l.urgent) ? "急料请到了优先点数、当天录到货单；" : ""}${lines.some((l) => l.needInspection) ? "标「需先检」的先报检、合格再入库；" : ""}到货数量与订单有出入当天告诉我。谢谢！`
    : `${dayWord}（${fmtLooseCn(target)}）没有到货，不用发预告。`;

  return { today: todayStr, targetDate: targetStr, lines, skipped, headline, markdown, message, flags };
}
