// 订单跟踪三色判定（05 §1 的程序化版本）。
// 输入 = 跟单表行（列名见 templates/tracking-sheet-template.csv），输出 = 每行 🔴逾期 / 🟡临期 / 🟢未到期 + 该做的动作 + 汇总 + 可贴给上级的 markdown 表。
// 不碰 IO / DOM / db；日期字段宽松解析（"2026-09-10" / "2026/9/10" / "2026.9.10" / "2026年9月10日" / Excel 带时分秒 都认）。

/** 跟单表一行：列名即 CSV 表头，值全是字符串 */
export type TrackingRow = Record<string, string>;

/** 已完结、不再进三色判定的状态（05 §2 状态枚举） */
export const CLOSED_STATUSES = ["已入库完结", "已关闭"] as const;
/** 跟单表状态枚举（05 §2） */
export const TRACKING_STATUSES = ["未发货", "已发货在途", "部分到货", "已到待入库", "已入库完结", "逾期", "已关闭"] as const;

/** 临期阈值：距承诺交期 ≤ 3 天（05 §1 表） */
export const DUE_SOON_DAYS = 3;

export type TrackColor = "red" | "yellow" | "green" | "done" | "unknown";

export interface TrackStatusInput {
  rows: TrackingRow[];
  /** 今天 YYYY-MM-DD（也接受 2026/9/3 等宽松格式） */
  today: string;
}

export interface TrackLine {
  orderNo: string;
  supplier: string;
  /** 「编码 名称」拼好的展示串 */
  material: string;
  qty: string;
  /** 归一化后的承诺交期 YYYY-MM-DD；解析失败则原样保留 */
  dueDate: string;
  status: string;
  color: TrackColor;
  /** 🔴 🟡 🟢 ✅ ❓ */
  icon: string;
  /** 距交期天数：负数=已逾期 N 天；完结/无法解析时为 undefined */
  daysLeft?: number;
  /** 一句话判定，如「已逾期 3 天」 */
  judgement: string;
  /** 现在该做什么（给新人照着做） */
  action: string;
  /** 跟进记录原文，方便打电话前先看一眼上次说了什么 */
  followUp: string;
  row: TrackingRow;
}

export interface TrackStatusResult {
  today: string;
  lines: TrackLine[];
  counts: { overdue: number; dueSoon: number; onTrack: number; done: number; unknown: number; total: number };
  /** 一句话总览 */
  headline: string;
  /** 逾期在前、临期次之的 markdown 表，可直接贴周报/群里 */
  markdown: string;
  /** 全局提醒（如有无法解析的日期） */
  flags: string[];
}

/* ---------- 日期工具（内部，宽松） ---------- */

/**
 * 宽松解析日期：接受 2026-09-10 / 2026/9/10 / 2026.9.10 / 2026年9月10日 / 20260910 / 以及后面跟着时分秒的 Excel 导出值。
 * 解析不了返回 undefined（不猜、不抛）。返回 UTC 正午的 Date，避免时区把日期挪一天。
 */
export function parseLoose(s: string | undefined | null): Date | undefined {
  if (s === undefined || s === null) return undefined;
  const t = String(s).trim();
  if (!t) return undefined;
  let m = /^(\d{4})\s*[-\/.年]\s*(\d{1,2})\s*[-\/.月]\s*(\d{1,2})\s*日?(?:[ T].*)?$/.exec(t);
  if (!m) m = /^(\d{4})(\d{2})(\d{2})$/.exec(t);
  if (!m) return undefined;
  const y = +m[1], mo = +m[2], d = +m[3];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return undefined;
  const date = new Date(Date.UTC(y, mo - 1, d, 12));
  // 2026-02-30 这种非法日会被 Date 悄悄进位，反查一遍拒掉
  if (date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return undefined;
  return date;
}

/** Date → YYYY-MM-DD */
export function fmtLoose(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** 宽松格式 → 归一化 YYYY-MM-DD；解析失败返回 undefined */
export function normalizeDate(s: string | undefined | null): string | undefined {
  const d = parseLoose(s);
  return d ? fmtLoose(d) : undefined;
}

/** b − a 的整天数 */
export function diffDays(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

const WEEKDAY_CN = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
/** 2026-09-10（周四） */
export function fmtLooseCn(d: Date): string {
  return `${fmtLoose(d)}（${WEEKDAY_CN[d.getUTCDay()]}）`;
}

/** 按候选列名取值（兼容「物料编码/存货编码」这类叫法差异） */
export function pickField(row: Record<string, string>, keys: string[]): string {
  for (const k of keys) {
    const v = row[k];
    if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}

export const isClosedStatus = (status: string) => (CLOSED_STATUSES as readonly string[]).includes(status.trim());

/* ---------- 主函数 ---------- */

export function trackStatus(rows: TrackingRow[], today: string): TrackStatusResult {
  const todayDate = parseLoose(today);
  if (!todayDate) throw new Error(`today 日期格式无法解析，收到「${today}」`);
  const todayStr = fmtLoose(todayDate);
  const flags: string[] = [];
  const lines: TrackLine[] = [];

  for (const row of rows) {
    const orderNo = pickField(row, ["订单号", "采购订单号", "PO"]);
    const supplier = pickField(row, ["供应商", "供应商名称"]);
    const code = pickField(row, ["物料编码", "存货编码", "编码"]);
    const name = pickField(row, ["物料名称", "存货名称", "物料", "名称"]);
    const material = [code, name].filter(Boolean).join(" ");
    const qty = pickField(row, ["数量", "订单数量"]);
    const status = pickField(row, ["状态"]);
    const rawDue = pickField(row, ["承诺交期", "计划到货日期", "交期"]);
    const followUp = pickField(row, ["跟进记录", "备注"]);
    const shipped = pickField(row, ["发货日"]);
    const tracking = pickField(row, ["物流单号"]);
    const due = parseLoose(rawDue);
    const dueDate = due ? fmtLoose(due) : rawDue;

    const base = { orderNo, supplier, material, qty, dueDate, status, followUp, row };

    // 完结行：不进三色，只计数
    if (isClosedStatus(status)) {
      lines.push({ ...base, color: "done", icon: "✅", judgement: `状态「${status}」，已完结`, action: "无需动作；月底核对入库未开票即可" });
      continue;
    }
    // 交期解析不了：不猜，让人补数据
    if (!due) {
      lines.push({
        ...base, color: "unknown", icon: "❓",
        judgement: rawDue ? `承诺交期「${rawDue}」格式对不上，无法判定` : "承诺交期为空，无法判定",
        action: "拿供应商回签单把承诺交期补成 YYYY-MM-DD 再跑一遍；没有回签的先去要回签——没回签的交期不算承诺",
      });
      continue;
    }

    const daysLeft = diffDays(todayDate, due);
    if (daysLeft < 0) {
      const late = -daysLeft;
      let action = `立即电话供应商：问清延误原因和新交期，把「${todayStr} 电话xx：原因/新交期」写进跟进记录；今天就通知生产/计划，别瞒`;
      if (status === "已到待入库") action = `货已到但没入库、卡在仓库：今天催仓库录到货单/入库单并审核，账实当天闭环（04 第三步）`;
      else if (status === "部分到货") action = `已部分到货、尾数逾期：电话供应商要欠交量的补货日期，跟单表登记欠交量；供应商不补就手工关闭订单行（04 第四步）`;
      else if (status === "已发货在途") action = `已发货但过了交期没到：查物流节点${tracking ? `（单号 ${tracking}）` : "（先向供应商要运单号）"}，物流停滞就供应商 + 物流两头催；今天通知生产`;
      lines.push({ ...base, color: "red", icon: "🔴", daysLeft, judgement: `已逾期 ${late} 天（承诺 ${dueDate} < 今天 ${todayStr}，状态「${status || "未填"}」未完结）`, action });
    } else if (daysLeft <= DUE_SOON_DAYS) {
      let action = daysLeft === 0
        ? `今天到期：确认货是否已在路上，问司机/物流预计几点到，并核对仓库已收到到货预告`
        : `距交期 ${daysLeft} 天：催货确认是否已排产/已发货，向供应商要物流公司 + 运单号 + 预计到达日`;
      if (status === "已发货在途") action = `距交期 ${daysLeft} 天、已发货：${tracking ? `查运单 ${tracking} 的物流节点` : "向供应商要运单号"}，停滞 2 天以上两头催；交期前一天把到货预告发仓库`;
      else if (status === "已到待入库") action = `货已到，催仓库当天录到货单/入库单，别让实物躺在角落`;
      lines.push({ ...base, color: "yellow", icon: "🟡", daysLeft, judgement: `临期：距承诺交期 ${dueDate} 还有 ${daysLeft} 天（≤ ${DUE_SOON_DAYS} 天）`, action });
    } else {
      let action = `距交期 ${daysLeft} 天：长周期物料每周确认一次进度即可，不用天天催`;
      if (status === "已发货在途") action = `距交期 ${daysLeft} 天、已发货${shipped ? `（${shipped} 发出）` : ""}：偶尔看一眼物流节点，异常再动`;
      lines.push({ ...base, color: "green", icon: "🟢", daysLeft, judgement: `未到期：距承诺交期 ${dueDate} 还有 ${daysLeft} 天`, action });
    }
  }

  const counts = {
    overdue: lines.filter((l) => l.color === "red").length,
    dueSoon: lines.filter((l) => l.color === "yellow").length,
    onTrack: lines.filter((l) => l.color === "green").length,
    done: lines.filter((l) => l.color === "done").length,
    unknown: lines.filter((l) => l.color === "unknown").length,
    total: lines.length,
  };
  if (counts.unknown) flags.push(`${counts.unknown} 行承诺交期为空或格式对不上，已单列，先补数据`);
  if (counts.overdue) flags.push(`${counts.overdue} 行已逾期：今天必须每行都有电话动作 + 通知生产，别攒到周报才说`);

  const order: Record<TrackColor, number> = { red: 0, yellow: 1, unknown: 2, green: 3, done: 4 };
  const sorted = [...lines].sort((a, b) => order[a.color] - order[b.color] || (a.daysLeft ?? 0) - (b.daysLeft ?? 0));

  const headline = rows.length === 0
    ? `跟单表是空的：没有可跟踪的订单行（今天 ${todayStr}）`
    : `今天 ${todayStr}：共 ${counts.total} 行，🔴 逾期 ${counts.overdue} / 🟡 临期 ${counts.dueSoon} / 🟢 未到期 ${counts.onTrack}${counts.done ? ` / ✅ 已完结 ${counts.done}` : ""}${counts.unknown ? ` / ❓ 交期缺失 ${counts.unknown}` : ""}`;

  const esc = (s: string) => s.replace(/\|/g, "／").replace(/\r?\n/g, " ");
  const header = "| 状态 | 订单号 | 供应商 | 物料 | 数量 | 承诺交期 | 表内状态 | 判定 | 动作 |\n|---|---|---|---|---|---|---|---|---|";
  const body = sorted.map((l) => `| ${l.icon} | ${esc(l.orderNo)} | ${esc(l.supplier)} | ${esc(l.material)} | ${esc(l.qty)} | ${esc(l.dueDate)} | ${esc(l.status)} | ${esc(l.judgement)} | ${esc(l.action)} |`).join("\n");
  const markdown = sorted.length ? `${header}\n${body}` : `_（跟单表无数据）_`;

  return { today: todayStr, lines: sorted, counts, headline, markdown, flags };
}
