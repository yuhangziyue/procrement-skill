// 三档判定（紧急 / 日常跟进 / 提醒）。规格：DESIGN-workbench-v2「最终方案 · 2 三档判定规则表」，
// 28 条规则（U1–U10 / F1–F11 / N1–N7）**自上而下短路，第一条命中即止**。
//
// 三条硬约束，破一条这层就废了：
// ① **band 与 score 各管一件事**：band 决定这张卡是什么性质（落哪个分区），score 只决定档内谁先做。
//    两者打架时 band 赢——唯一的反向通道是 U10（score ≥ 175），且命中时必须往 reasons[] 留一条证。
// ② **只读卡片自身字段 + ctx.bizDate**。不读别的卡、不读当前时间、不查库：
//    同一张卡什么时候算都是同一档，顺序才不会莫名其妙变。
// ③ 规则表导出为数据（BAND_RULES），测试逐条打正例——规则改了测试立刻红，不靠人肉对表。
import { addDays, fmt, isWorkday, parseDate } from "../tools/calendar";
import type { Band, BoardTask } from "./types";

export interface BandCtx {
  bizDate: string;
}
export interface BandResult {
  band: Band;
  ruleId: string;
  why: string;
}

/**
 * 判定要用、但 BoardTask 上没有独立字段的几个事实（断线等级、是否已断料、加单授权齐没齐、差异比例）。
 * types.ts 是老架定稿不许动，所以由 generate.ts 在造卡时写进 `sourceRow.__bandFacts`，
 * 这里只读、缺了就退保守值——**不猜，也不去查别的卡**（约束②）。
 */
export const BAND_FACTS_KEY = "__bandFacts";
export interface BandFacts {
  demandLevel?: "daily" | "week" | "next" | "refill";
  stockedOut?: boolean;
  /** 加单：授权人 + 授权凭据都齐了才算 true */
  hasAuth?: boolean;
  /** 到货差异比例 = |差异量| / 订单量 */
  diffRatio?: number;
}

export function bandFactsOf(t: BoardTask): BandFacts {
  const raw = t.sourceRow?.[BAND_FACTS_KEY];
  return raw && typeof raw === "object" ? (raw as BandFacts) : {};
}

/* ── 小工具：日期与工作日，都只依赖 bizDate ── */
const dayAfter = (d: string, n = 1) => fmt(addDays(parseDate(d), n));
const cov = (t: BoardTask) => t.coverageDays;
const isDaily = (t: BoardTask) => bandFactsOf(t).demandLevel === "daily";
const isStockedOut = (t: BoardTask) => bandFactsOf(t).stockedOut === true;

/** from（不含）到 to（含）之间的工作日数；to 更早则为负。节假日走 calendar.ts。 */
export function workdaysTo(from: string, to: string): number {
  if (from === to) return 0;
  const back = to < from;
  let cur = parseDate(back ? to : from);
  const end = parseDate(back ? from : to);
  let n = 0;
  let guard = 0;
  while (fmt(cur) < fmt(end) && guard++ < 800) {
    cur = addDays(cur, 1);
    if (isWorkday(cur)) n++;
  }
  return back ? -n : n;
}

/** 「会不会断料」的统一口径：日配件 / 覆盖 < 3 天 / 已断料，命中一个就算 */
const willStarve = (t: BoardTask) => isDaily(t) || (cov(t) !== undefined && cov(t)! < 3) || isStockedOut(t);

export interface BandRule {
  id: string;
  band: Band;
  /** 规则一句话，写给读代码的人 */
  spec: string;
  test(t: BoardTask, ctx: BandCtx): boolean;
  why(t: BoardTask, ctx: BandCtx): string;
}

/** U10 命中时调用方要往 reasons[] 追加的那一条证：这条不是规则挑上来的，是分数顶上来的 */
export const U10_RULE_ID = "U10";
export function u10Proof(t: BoardTask): string {
  return `U10 反向通道：这条本来算日常跟进，是分数把它顶上来的（${t.score} 分 ≥ 175，命中 R1 置顶且基础分已过 P0 线）。不服气就看 reasons 里的六因子明细。`;
}

/**
 * 28 条规则，**顺序即语义**：紧急 10 条 → 日常跟进 11 条 → 提醒 7 条，自上而下第一条命中即返回。
 * 改顺序 = 改产品含义，别为了"看起来整齐"重排。
 */
export const BAND_RULES: BandRule[] = [
  /* ═══ 🔴 紧急：今天不动，明天就是事故 ═══ */
  {
    id: "U1", band: "urgent", spec: "kind = T1B_late",
    test: (t) => t.kind === "T1B_late",
    why: () => "按常规周期今天下单已经来不及了——今天要的不是下单，是一个补救方案的书面结论",
  },
  {
    id: "U2", band: "urgent", spec: "kind = T1_shortage 且 dueDate ≤ bizDate",
    test: (t, c) => t.kind === "T1_shortage" && !!t.dueDate && t.dueDate <= c.bizDate,
    why: (t, c) => `最晚下单日 ${t.dueDate}${t.dueDate === c.bizDate ? " 就是今天" : " 已经过了"}，今天不下单就赶不上需求日`,
  },
  {
    id: "U3", band: "urgent", spec: "kind = T2_addon 且（isUrgent 或 needDate ≤ bizDate+1）",
    test: (t, c) => t.kind === "T2_addon" && (t.isUrgent === true || (!!t.needDate && t.needDate <= dayAfter(c.bizDate))),
    why: (t) => (t.isUrgent ? "加单表上标了「急」" : `加单要的是 ${t.needDate}，最迟明天就得到货`) + "——急单最容易漏，今天必须有结论",
  },
  {
    id: "U4", band: "urgent", spec: "kind = T10_daily_check 且 coverageDays < 3",
    test: (t) => t.kind === "T10_daily_check" && cov(t) !== undefined && cov(t)! < 3,
    why: (t) => `日配件水位只剩 ${cov(t)!.toFixed(1)} 天，已经压到 3 天红线以下——先调拨再催货，同时通知生产`,
  },
  {
    id: "U5", band: "urgent", spec: "kind ∈ {T5_transit, T6_notice} 且 promiseDate = bizDate",
    test: (t, c) => (t.kind === "T5_transit" || t.kind === "T6_notice") && t.promiseDate === c.bizDate,
    why: () => "承诺就是今天到——今天到没到，今天就得有个准信，明天再问就晚了",
  },
  {
    id: "U6", band: "urgent", spec: "kind = T7_not_stocked 且 arriveDate = bizDate",
    test: (t, c) => t.kind === "T7_not_stocked" && t.arriveDate === c.bizDate,
    why: () => "货今天到了但账上没入库，生产领不出料——当天到货当天入库，隔夜就说不清数量",
  },
  {
    id: "U7", band: "urgent", spec: "kind = T8_overdue 且（日配 / coverage<3 / 已断料）",
    test: (t) => t.kind === "T8_overdue" && willStarve(t),
    why: (t) => `已经逾期，而且${isStockedOut(t) ? "现场已经断料" : isDaily(t) ? "这是日配件，断一天停一条线" : `库存只够 ${cov(t)!.toFixed(1)} 天`}——逾期本身不紧急，逾期会断料才紧急`,
  },
  {
    id: "U8", band: "urgent", spec: "kind = T9_discrepancy 且（日配 / coverage<3 / 差异比例 ≥ 10%）",
    test: (t) => t.kind === "T9_discrepancy" && (isDaily(t) || (cov(t) !== undefined && cov(t)! < 3) || (bandFactsOf(t).diffRatio ?? 0) >= 0.1),
    why: (t) => {
      const r = bandFactsOf(t).diffRatio ?? 0;
      return `到货差异会影响生产（${isDaily(t) ? "日配件" : cov(t) !== undefined && cov(t)! < 3 ? `库存只够 ${cov(t)!.toFixed(1)} 天` : `差异比例 ${(r * 100).toFixed(1)}% ≥ 10%`}）——当天不定性，三天后谁都说不清`;
    },
  },
  {
    id: "U9", band: "urgent", spec: "kind = T13_payment 且 dueDate ≤ bizDate+1",
    test: (t, c) => t.kind === "T13_payment" && !!t.dueDate && t.dueDate <= dayAfter(c.bizDate),
    why: (t) => `付款/开票节点 ${t.dueDate} 最晚就是明天——钱和票卡住，下一批货就别想催了`,
  },
  {
    id: U10_RULE_ID, band: "urgent", spec: "score ≥ 175（唯一的分数反向通道）",
    test: (t) => (t.score ?? 0) >= 175,
    why: (t) => `分数 ${t.score} 已经到 175（R1 置顶 + 基础分过 P0 线），规则表没挑上它，但分数把它顶上来了`,
  },

  /* ═══ 🟡 日常跟进：今天必须有一个动作，不要求闭环 ═══ */
  {
    id: "F1", band: "follow", spec: "kind = T5_transit（未命中 U5）",
    test: (t) => t.kind === "T5_transit",
    why: (t) => `在途盯运输：${t.promiseDate ? `承诺 ${t.promiseDate} 到，` : ""}今天问一句到哪一步了就算数`,
  },
  {
    id: "F2", band: "follow", spec: "kind = T8_overdue（未命中 U7）",
    test: (t) => t.kind === "T8_overdue",
    why: () => "已经逾期但暂时断不了料——今天要一个新交期，并把它同步给生产",
  },
  {
    id: "F3", band: "follow", spec: "kind = T4_unconfirmed",
    test: (t) => t.kind === "T4_unconfirmed",
    why: () => "回签是主动要的，不是等来的——没有书面回签，这张单就还是一厢情愿",
  },
  {
    id: "F4", band: "follow", spec: "kind = T7_not_stocked（未命中 U6）",
    test: (t) => t.kind === "T7_not_stocked",
    why: () => "货到了账上还没入库，今天跟仓库对一次，问清卡在哪一步",
  },
  {
    id: "F5", band: "follow", spec: "kind = T9_discrepancy（未命中 U8）",
    test: (t) => t.kind === "T9_discrepancy",
    why: () => "差异暂时不影响生产，但今天要定性并同步供应商与仓库两边",
  },
  {
    id: "F6", band: "follow", spec: "kind = T1_shortage 且 dueDate > bizDate",
    test: (t, c) => t.kind === "T1_shortage" && !!t.dueDate && t.dueDate > c.bizDate,
    why: (t, c) => `离最晚下单日 ${t.dueDate} 还有 ${workdaysTo(c.bizDate, t.dueDate!)} 个工作日，今天推进一步就行`,
  },
  {
    id: "F7", band: "follow", spec: "kind = T2_addon 且授权齐（未命中 U3）",
    test: (t) => t.kind === "T2_addon" && bandFactsOf(t).hasAuth === true,
    why: () => "加单授权已经齐了，按常规单走：算一遍账，新开一张 PO，不改原单",
  },
  {
    id: "F8", band: "follow", spec: "kind = T6_notice（未命中 U5）",
    test: (t) => t.kind === "T6_notice",
    why: () => "明日到货预告是固定动作，今天要发出去并拿到仓库回执",
  },
  {
    id: "F9", band: "follow", spec: "kind = T10_daily_check 且 3 ≤ coverageDays < 7",
    test: (t) => t.kind === "T10_daily_check" && cov(t) !== undefined && cov(t)! >= 3 && cov(t)! < 7,
    why: (t) => `水位 ${cov(t)!.toFixed(1)} 天，在 3~7 天的观察区——今天把数字录了，顺手看一眼在途`,
  },
  {
    id: "F10", band: "follow", spec: "kind = T3_intercept 且 距最晚下单日 ≤ 2 个工作日（逃逸条款）",
    test: (t, c) => t.kind === "T3_intercept" && !!t.dueDate && workdaysTo(c.bizDate, t.dueDate) <= 2,
    why: (t, c) => `拦截拖到只剩 ${workdaysTo(c.bizDate, t.dueDate!)} 个工作日了——不再是"等回话"，今天要逼出一个答复`,
  },
  {
    id: "F11", band: "follow", spec: "kind = T13_payment（未命中 U9）",
    test: (t) => t.kind === "T13_payment",
    why: (t) => `付款/开票节点 ${t.dueDate ?? "未填"}，今天推一步，别等到到期那天才发现缺资料`,
  },

  /* ═══ ⚪ 提醒：我推出去了，等别人；今天只看一眼、必要时催一句 ═══ */
  {
    id: "N1", band: "notice", spec: "kind = T3_intercept（未命中 F10）",
    test: (t) => t.kind === "T3_intercept",
    why: () => "买不买、买哪个编码还没定，球在提出人那边——今天看一眼有没有回话",
  },
  {
    id: "N2", band: "notice", spec: "kind = T2_addon 且授权未齐",
    test: (t) => t.kind === "T2_addon" && bandFactsOf(t).hasAuth !== true,
    why: () => "加单还没拿到书面授权，等的是提出人一句文字——拿到文字前不下单",
  },
  {
    id: "N3", band: "notice", spec: "kind = T1_shortage 且 awaitingApproval",
    test: (t) => t.kind === "T1_shortage" && t.awaitingApproval === true,
    why: () => "请购单在审批流里，今天推不动它——看一眼卡在谁那儿，超时再催",
  },
  {
    id: "N4", band: "notice", spec: "kind = T14_conflict",
    test: (t) => t.kind === "T14_conflict",
    why: () => "判断层与事实层对不上，要的是数据源那边改——小采永不替你改 U8，也不替你改生产表",
  },
  {
    id: "N5", band: "notice", spec: "kind = T10_daily_check 且 coverageDays ≥ 7",
    test: (t) => t.kind === "T10_daily_check" && cov(t) !== undefined && cov(t)! >= 7,
    why: (t) => `水位 ${cov(t)!.toFixed(1)} 天，够用——录个数字就行，不用动别的`,
  },
  {
    id: "N6", band: "notice", spec: "blockedBy ≠ none 且已升级过",
    test: (t) => {
      const b = t.editable?.blockedBy;
      return !!b && b !== "none" && !!(t.editable?.escalatedTo ?? "").trim();
    },
    why: (t) => `卡在${{ warehouse: "仓库", finance: "财务", production: "生产", supplier: "供应商", none: "" }[t.editable?.blockedBy ?? "none"]}，已经升级给 ${t.editable?.escalatedTo}——今天不用再推，等回话`,
  },
  {
    id: "N7", band: "notice", spec: "兜底：以上全不命中",
    test: () => true,
    why: () => "没命中任何紧急或跟进条件，先放提醒区，每天扫一眼",
  },
];

/** 构建期自查：规则 id 不重名，且兜底必须在最后一条 —— 顺序即语义，排错了会静默吃掉后面的规则 */
{
  const ids = new Set<string>();
  for (const r of BAND_RULES) {
    if (ids.has(r.id)) throw new Error(`band.ts 规则 id 重复：${r.id}`);
    ids.add(r.id);
  }
  if (BAND_RULES[BAND_RULES.length - 1].id !== "N7") throw new Error("band.ts：兜底规则 N7 必须排在最后一条");
}

/**
 * 这张卡今天是哪一档。自上而下短路，第一条命中即返回。
 * 命中 U10 时调用方要把 `u10Proof(task)` 追加进 reasons[]（规格：分数反向通道必须留证）。
 */
export function bandOf(task: BoardTask, ctx: BandCtx): BandResult {
  for (const r of BAND_RULES) {
    if (r.test(task, ctx)) return { band: r.band, ruleId: r.id, why: r.why(task, ctx) };
  }
  // BAND_RULES 最后一条是恒真兜底，走不到这里；留着是为了类型完备而不是为了容错
  return { band: "notice", ruleId: "N7", why: "没命中任何规则，先放提醒区" };
}
