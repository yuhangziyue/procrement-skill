// 下单算量（03 §场景1 第一步 + order-checklist §A 的程序化版本）。
// 净缺口 = 需求 − 被替代 − 可用量 − 有效在途；多仓调拨优先；MOQ 三选一让人定；凑整向上取整。每步算式原样输出。

export interface TransitLine {
  qty: number;
  plannedDate?: string;
  /** 跟单表里已逾期未决的在途不算有效在途 */
  overdue?: boolean;
  note?: string;
}

export interface WarehouseLine {
  name: string;
  onHand: number;
  inTransit?: number;
  /** 他仓自己生产表的需求。缺这个数就不算调拨（只看库存数调货 = 把别人的产线调停了） */
  ownDemand?: number;
  safety?: number;
  /** 调拨运输天数 */
  transferDays?: number;
}

export interface CalcInput {
  item: string;
  /** 物料表里的采购状态：停购/警示/按需 会改变结论 */
  status?: string;
  demand: number;
  substituted?: number;
  /** 可用量（不是现存量：被其他订单预占的不能算） */
  available: number;
  inTransit?: TransitLine[];
  today?: string;
  otherWarehouses?: WarehouseLine[];
  /** 距需求日还有几天，用来判断调拨来得及 */
  daysUntilNeed?: number;
  moq?: number;
  /** 凑整单位（扎/箱的数量） */
  packUnit?: number;
  maxPerOrder?: number;
  monthlyCapacity?: number;
  batchThreshold?: number;
}

export interface CalcResult {
  verdict: "no_order" | "order" | "blocked" | "confirm_first";
  headline: string;
  steps: string[];
  validTransit: number;
  overdueTransit: number;
  rawGap: number;
  transfers: { from: string; qty: number }[];
  purchaseGap: number;
  moqOptions?: string[];
  roundedQty?: number;
  roundedExtra?: number;
  flags: string[];
}

export function calcOrderQty(i: CalcInput): CalcResult {
  const steps: string[] = [];
  const flags: string[] = [];
  const status = i.status ?? "";

  // 0. 采购状态拦截
  if (/停购|下架/.test(status)) {
    return {
      verdict: "blocked",
      headline: `⛔ 「${i.item}」采购状态为「${status}」：不下单。先反问生产是否真要复用旧包材，书面确认后再谈。`,
      steps: [],
      validTransit: 0, overdueTransit: 0, rawGap: 0, transfers: [], purchaseGap: 0, flags,
    };
  }
  if (/警示/.test(status)) flags.push(`采购状态「${status}」：可下单，但先确认物料还活着，量放保守`);
  if (/按需/.test(status)) flags.push(`采购状态「${status}」：必须有明确需求来源（生产表/书面通知）才下`);

  // 1. 有效在途
  const today = i.today ?? new Date().toISOString().slice(0, 10);
  let valid = 0, overdue = 0;
  for (const t of i.inTransit ?? []) {
    const late = t.overdue || (t.plannedDate ? t.plannedDate < today : false);
    if (late) overdue += t.qty; else valid += t.qty;
  }
  if (overdue > 0) flags.push(`在途中有 ${overdue} 已逾期未决，不算有效在途——先去催，催不动就当没有`);

  const substituted = i.substituted ?? 0;
  const rawGap = i.demand - substituted - i.available - valid;
  steps.push(`净缺口 = 需求 ${i.demand} − 被替代 ${substituted} − 可用量 ${i.available} − 有效在途 ${valid} = ${rawGap}`);

  if (rawGap <= 0) {
    return {
      verdict: "no_order",
      headline: `✅ 「${i.item}」不用下单：净缺口 ${rawGap} ≤ 0，库存 + 在途够用。`,
      steps, validTransit: valid, overdueTransit: overdue, rawGap, transfers: [], purchaseGap: 0, flags,
    };
  }

  // 2. 多仓调拨优先
  let remaining = rawGap;
  const transfers: { from: string; qty: number }[] = [];
  for (const w of i.otherWarehouses ?? []) {
    if (w.ownDemand === undefined) {
      flags.push(`「${w.name}」缺自己的生产表需求，不算调拨——两张生产表都拿到才能算`);
      continue;
    }
    const avail = w.onHand + (w.inTransit ?? 0) - w.ownDemand - (w.safety ?? 0);
    steps.push(`${w.name} 可调量 = 现存 ${w.onHand} + 在途 ${w.inTransit ?? 0} − 自需 ${w.ownDemand} − 安全量 ${w.safety ?? 0} = ${avail}`);
    if (avail <= 0) continue;
    if (w.transferDays !== undefined && i.daysUntilNeed !== undefined && w.transferDays > i.daysUntilNeed) {
      flags.push(`「${w.name}」调拨要 ${w.transferDays} 天，需求只剩 ${i.daysUntilNeed} 天，来不及，不调`);
      continue;
    }
    const q = Math.min(avail, remaining);
    transfers.push({ from: w.name, qty: q });
    remaining -= q;
    steps.push(`从 ${w.name} 调拨 ${q}，剩余缺口 ${remaining}`);
    if (remaining <= 0) break;
  }
  if (transfers.length) flags.push("调拨要留痕：开调拨单 + 通知两边仓库和需求方，跟单表记调拨单号/数量/预计到达");

  const purchaseGap = Math.max(remaining, 0);
  if (purchaseGap === 0) {
    return {
      verdict: "no_order",
      headline: `✅ 「${i.item}」调拨即可覆盖，不用采购：${transfers.map((t) => `${t.from} 调 ${t.qty}`).join("，")}。`,
      steps, validTransit: valid, overdueTransit: overdue, rawGap, transfers, purchaseGap, flags,
    };
  }

  // 3. MOQ 三选一（工具不替人选）
  let moqOptions: string[] | undefined;
  if (i.moq && purchaseGap < i.moq) {
    moqOptions = [
      `① 凑到 MOQ ${i.moq}（多出 ${i.moq - purchaseGap}，算库存资金占用，量小可接受）`,
      `② 问供应商能否拼单 / 加价接 ${purchaseGap} 的小单`,
      `③ 和生产确认能否合并下次需求一起下`,
    ];
    steps.push(`采购缺口 ${purchaseGap} < MOQ ${i.moq}，需三选一`);
  }

  // 4. 凑整
  let roundedQty: number | undefined, roundedExtra: number | undefined;
  const base = i.moq && purchaseGap < i.moq ? i.moq : purchaseGap;
  if (i.packUnit && i.packUnit > 0) {
    roundedQty = Math.ceil(base / i.packUnit) * i.packUnit;
    roundedExtra = roundedQty - purchaseGap;
    steps.push(`按凑整单位 ${i.packUnit} 向上取整：⌈${base} / ${i.packUnit}⌉ × ${i.packUnit} = ${roundedQty}（比缺口多 ${roundedExtra}），把凑整后的量写进 PO`);
  }
  const finalQty = roundedQty ?? base;

  // 5. 产能 / 分批
  if (i.maxPerOrder && finalQty > i.maxPerOrder) flags.push(`超过单次最大接单量 ${i.maxPerOrder}：提前锁排产，或拆单给备用供应商`);
  if (i.monthlyCapacity && finalQty > i.monthlyCapacity) flags.push(`超过月产能 ${i.monthlyCapacity}：必须提前和供应商锁排产`);
  if (i.batchThreshold && finalQty > i.batchThreshold) flags.push(`超过分批阈值 ${i.batchThreshold}：PO 里写明批次计划（首批比例、各批到货日），每批单独进跟单表`);

  const verdict = moqOptions ? "confirm_first" : "order";
  const headline = moqOptions
    ? `➡️ 「${i.item}」采购缺口 ${purchaseGap}，低于 MOQ ${i.moq}，你定一个方案再下单。`
    : `📝 「${i.item}」建议下单 ${finalQty}${transfers.length ? `（另从他仓调拨 ${transfers.reduce((s, t) => s + t.qty, 0)}）` : ""}。`;

  return { verdict, headline, steps, validTransit: valid, overdueTransit: overdue, rawGap, transfers, purchaseGap, moqOptions, roundedQty, roundedExtra, flags };
}
