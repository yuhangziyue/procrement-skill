// 从「导进来的几张表」生成今天的看板卡片。采姐 spec-cai.md §2 十二类任务逐条落地。
//
// 三条不能破的规矩：
// ① **优雅降级**：只导了一张生产表也要能出「要下单」泳道的卡。缺的列不猜，进 warnings 用人话说清楚退化成了什么口径。
// ② **id 可重算**：同一物料、同一天、同一类 → 永远同一个 id。否则每次刷新都会把她勾过的步骤冲掉。
// ③ **每张卡必须答两个问题**：什么算干完（doneRule）、卡住了找谁 + 第一句话怎么说（escalation）。
//    「跟进一下」这种话在这里是 bug（苏姐铁律④）。
import { addDays, fmt, isWorkday, parseDate } from "../tools/calendar";
import { arrivalNotice } from "../tools/arrival-notice";
import { backwardSchedule } from "../tools/backward-schedule";
import { calcOrderQty, type TransitLine } from "../tools/calc-order-qty";
import { isClosedStatus, normalizeDate } from "../tools/track-status";
import { reasonsOf, scoreTask, type ScoreContext } from "./score";
import type { BoardTask, Stage, TaskKind, TaskStep } from "./types";

export interface SourceTables {
  production?: Record<string, string>[];
  addon?: Record<string, string>[];
  poLines?: Record<string, string>[];
  arrivals?: Record<string, string>[];
  inventory?: Record<string, string>[];
  materials?: Record<string, string>[];
}

/** 泳道映射（老架定稿）：一张卡只能有一个家 */
export const STAGE_OF: Record<TaskKind, Stage> = {
  T1_shortage: "order",
  T1B_late: "order",
  T2_addon: "order",
  T3_intercept: "order",
  T10_daily_check: "order",
  T4_unconfirmed: "confirm",
  T5_transit: "transit",
  T8_overdue: "transit",
  T6_notice: "inbound",
  T7_not_stocked: "inbound",
  T9_discrepancy: "inbound",
};

/** 没有供应商档案时的通用兜底口径。用了就必须进 warnings，不许闷声用默认值算出一个像模像样的日期。 */
export const FALLBACK = { productionDays: 7, transportDays: 2, onTimeRate: 0.8, arrivalBuffer: 1 } as const;

/* ═══════════════ 一、列名模糊匹配 ═══════════════ */

/** 归一化列名：去空格/标点/全角，转小写。「物料编码 」「物料 编码」「物料编码(必填)」都归到一起 */
export function normalizeHeader(h: string): string {
  return String(h)
    .replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[\s　()[\]{}【】<>《》:：,，.。、/\\|*#_\-—+]/g, "")
    .toLowerCase();
}

/**
 * 按候选列名从一行里取值。三级匹配：原样 → 归一化相等 → 归一化包含。
 * 「物料编码 / 存货编码 / 料号」都要认——她拿到的表来自四个地方，列名从来不统一。
 */
export function pickColumn(row: Record<string, string>, aliases: string[]): string {
  for (const a of aliases) {
    const v = row[a];
    if (v !== undefined && String(v).trim() !== "") return String(v).trim();
  }
  const keys = Object.keys(row);
  const norm = new Map(keys.map((k) => [normalizeHeader(k), k]));
  for (const a of aliases) {
    const k = norm.get(normalizeHeader(a));
    if (k !== undefined && String(row[k] ?? "").trim() !== "") return String(row[k]).trim();
  }
  for (const a of aliases) {
    const na = normalizeHeader(a);
    for (const k of keys) {
      const nk = normalizeHeader(k);
      if ((nk.includes(na) || na.includes(nk)) && String(row[k] ?? "").trim() !== "") return String(row[k]).trim();
    }
  }
  return "";
}

/** 这批行里到底有没有这一列（用于 warnings：区分「列不存在」和「列存在但这行是空的」） */
export function hasColumn(rows: Record<string, string>[], aliases: string[]): boolean {
  const nas = aliases.map(normalizeHeader);
  return rows.some((r) => Object.keys(r).some((k) => {
    const nk = normalizeHeader(k);
    return nas.some((na) => nk === na || nk.includes(na) || na.includes(nk));
  }));
}

export const COLS = {
  code: ["物料编码", "存货编码", "料号", "物料代码", "存货代码", "编码", "物料号"],
  name: ["物料名称", "存货名称", "品名", "物料", "名称"],
  qty: ["需求数量", "需求量", "数量", "订单数量", "计划数量", "本次数量"],
  needDate: ["需求日期", "需求日", "要求到货日期", "用料日期", "计划用料日", "上线日期"],
  warehouse: ["需求仓库", "收货仓库", "仓库", "仓库名称"],
  supplier: ["供应商", "供应商名称", "厂商", "供货商"],
  purchaseStatus: ["采购状态", "物料状态", "存货状态"],
  dailyUsage: ["日均用量", "日用量", "平均日用量", "日耗"],
  moq: ["moq", "最小起订量", "起订量"],
  packUnit: ["凑整单位", "包装单位", "装箱量", "每扎数量", "包装数量"],
  price: ["最近成交价", "含税单价", "单价", "参考价", "最新价"],
  onTimeRate: ["准交率", "准时交货率", "及时率"],
  available: ["可用量", "可用库存", "净可用", "可用数量"],
  onHand: ["现存量", "库存数量", "结存数量", "现存数量", "库存"],
  poNo: ["订单号", "采购订单号", "po", "订单编号"],
  promiseDate: ["承诺交期", "承诺到货日", "计划到货日期", "交期", "预计到货日期"],
  trackStatus: ["状态", "订单状态", "执行状态"],
  openQty: ["未到数量", "未交数量", "在途数量"],
  receivedQty: ["累计到货", "到货数量", "实到数量", "实收数量"],
  stockedQty: ["累计入库", "入库数量", "已入库数量"],
  signedBack: ["回签日期", "回签时间", "签回日期", "确认日期"],
  inspect: ["质检结论", "检验结论", "质检结果"],
  requester: ["提出人", "申请人", "需求人"],
  authorizedBy: ["授权人", "审批人", "批准人"],
  evidence: ["授权凭据", "凭据", "截图", "证据", "附件"],
  urgent: ["是否急", "急件", "加急"],
  remark: ["备注", "原始备注", "说明"],
} as const;

/* ═══════════════ 二、小工具 ═══════════════ */

const num = (s: string): number | undefined => {
  if (!s) return undefined;
  const v = Number(String(s).replace(/[,，\s]/g, "").replace(/[^\d.\-]/g, ""));
  return Number.isFinite(v) ? v : undefined;
};

/** 从 from（不含）数到 to（含）之间的工作日数；to 早于 from 则为负。节假日走 calendar.ts。 */
export function workdaysBetween(from: string, to: string): number {
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

/** 编码未命中时给「最相近的 3 个编码」供人工核对——只给参考，绝不自动替换 */
export function nearestCodes(code: string, all: string[], n = 3): string[] {
  const score = (c: string) => {
    let i = 0;
    while (i < code.length && i < c.length && code[i] === c[i]) i++;
    return i * 100 - Math.abs(c.length - code.length);
  };
  return [...all].sort((a, b) => score(b) - score(a) || (a < b ? -1 : 1)).slice(0, n);
}

/** 稳定 id：同一物料 + 同一天 + 同一类 → 同一个 id，刷新不丢她勾过的步骤 */
export function taskId(kind: TaskKind, key: string, bizDate: string): string {
  const safe = String(key).trim().replace(/\s+/g, "_") || "na";
  return `${kind}|${safe}|${bizDate}`;
}

const step = (id: string, text: string, where?: string): TaskStep => ({ id, text, where });
const U8 = (path: string) => `U8：${path} ⚠️ 待实机核对`;

/* ═══════════════ 三、索引 ═══════════════ */

interface Mat {
  code: string;
  name: string;
  status: string;
  supplier: string;
  dailyUsage?: number;
  moq?: number;
  packUnit?: number;
  price?: number;
  onTimeRate?: number;
  remark: string;
}

const isDaily = (m?: Mat) => !!m && /日配/.test(m.status);
const isBlockedStatus = (s: string) => /停购|下架/.test(s);
const isWarnStatus = (s: string) => /警示|按需/.test(s);
const isBuyable = (s: string) => /^在购/.test(s) || s === "";

interface Ctx {
  bizDate: string;
  now: number;
  mats: Map<string, Mat>;
  matCodes: string[];
  avail: Map<string, number>;
  transit: Map<string, TransitLine[]>;
  warn: (s: string) => void;
}

/* ═══════════════ 四、造卡 ═══════════════ */

interface Draft {
  kind: TaskKind;
  key: string;
  title: string;
  materialCode?: string;
  materialName?: string;
  supplier?: string;
  poNo?: string;
  qty?: number;
  needDate?: string;
  promiseDate?: string;
  dueDate?: string;
  steps: TaskStep[];
  doneRule: string;
  escalation: string;
  score: ScoreContext;
  sourceRow?: Record<string, unknown>;
}

function build(d: Draft, ctx: Ctx): BoardTask {
  const b = scoreTask(d.score);
  return {
    id: taskId(d.kind, d.key, ctx.bizDate),
    kind: d.kind,
    stage: STAGE_OF[d.kind],
    status: "todo",
    title: d.title,
    materialCode: d.materialCode,
    materialName: d.materialName,
    supplier: d.supplier,
    poNo: d.poNo,
    qty: d.qty,
    needDate: d.needDate,
    promiseDate: d.promiseDate,
    dueDate: d.dueDate,
    score: b.score,
    reasons: reasonsOf(b),
    steps: d.steps,
    doneSteps: [],
    doneRule: d.doneRule,
    escalation: d.escalation,
    sourceRow: d.sourceRow,
    bizDate: ctx.bizDate,
    createdAt: ctx.now,
    updatedAt: ctx.now,
    closedAt: null,
  };
}

/** 需求日 → 断线等级（苏姐 §4 的 S 因子口径） */
function demandLevelOf(m: Mat | undefined, needDate: string | undefined, bizDate: string): ScoreContext["demandLevel"] {
  if (isDaily(m)) return "daily";
  if (!needDate) return "refill";
  const d = workdaysBetween(bizDate, needDate);
  if (d <= 5) return "week";
  if (d <= 10) return "next";
  return "refill";
}

export function generateTasks(
  src: SourceTables,
  bizDate: string,
  opts?: { today?: Date },
): { tasks: BoardTask[]; warnings: string[] } {
  const warnings: string[] = [];
  const seen = new Set<string>();
  const warn = (s: string) => { if (!seen.has(s)) { seen.add(s); warnings.push(s); } };
  const now = opts?.today?.getTime() ?? Date.now();
  const production = src.production ?? [];
  const addon = src.addon ?? [];
  const poLines = src.poLines ?? [];
  const arrivals = src.arrivals ?? [];
  const inventory = src.inventory ?? [];
  const materialRows = src.materials ?? [];

  /* ── 物料索引 ── */
  const mats = new Map<string, Mat>();
  for (const r of materialRows) {
    const code = pickColumn(r, [...COLS.code]);
    if (!code) continue;
    mats.set(code, {
      code,
      name: pickColumn(r, [...COLS.name]) || code,
      status: pickColumn(r, [...COLS.purchaseStatus]),
      supplier: pickColumn(r, [...COLS.supplier]),
      dailyUsage: num(pickColumn(r, [...COLS.dailyUsage])),
      moq: num(pickColumn(r, [...COLS.moq])),
      packUnit: num(pickColumn(r, [...COLS.packUnit])),
      price: num(pickColumn(r, [...COLS.price])),
      onTimeRate: num(pickColumn(r, [...COLS.onTimeRate])),
      remark: pickColumn(r, [...COLS.remark]),
    });
  }
  if (materialRows.length === 0 && production.length > 0) {
    warn("没有导物料表：认不出哪些编码是停购/日配，全部当「在购」算，拦截卡（T3）这一轮出不来。把 152 项物料表导进来才准。");
  } else if (materialRows.length > 0 && !hasColumn(materialRows, [...COLS.purchaseStatus])) {
    warn("物料表里没有「采购状态」列：停购/警示/日配都判不出来，全部按在购处理——停购料可能被当成正常缺料下单，导进来前先确认这一列。");
  }
  if (materialRows.length > 0 && !hasColumn(materialRows, [...COLS.dailyUsage])) {
    warn("物料表里没有「日均用量」列：覆盖天数算不出来，断料风险因子退化为按需求日期估（采姐口径：不知道当中等风险，不当没风险）。");
  }

  /* ── 库存索引：可用量优先，没有可用量才退现存量 ── */
  const avail = new Map<string, number>();
  if (inventory.length) {
    const hasAvail = hasColumn(inventory, [...COLS.available]);
    if (!hasAvail && hasColumn(inventory, [...COLS.onHand])) {
      warn("现存量表里没有「可用量」列，退而用「现存量」算缺口——现存量里含被别的订单预占的部分，算出来的缺口会偏小，容易少下单。U8 里把可用量那一列一起导出来。");
    }
    for (const r of inventory) {
      const code = pickColumn(r, [...COLS.code]);
      if (!code) continue;
      const v = num(pickColumn(r, hasAvail ? [...COLS.available] : [...COLS.onHand]));
      if (v === undefined) continue;
      avail.set(code, (avail.get(code) ?? 0) + v);
    }
  } else if (production.length) {
    warn("没有导现存量表：可用量一律按 0 算，净缺口 = 全部需求量，会偏大。下单前务必自己核一遍 U8 现存量查询 ⚠️ 待实机核对。");
  }

  /* ── 在途索引（来自跟单表/订单执行报表） ── */
  const transit = new Map<string, TransitLine[]>();
  for (const r of poLines) {
    const code = pickColumn(r, [...COLS.code]);
    if (!code) continue;
    const st = pickColumn(r, [...COLS.trackStatus]);
    if (isClosedStatus(st)) continue;
    const open = num(pickColumn(r, [...COLS.openQty])) ?? num(pickColumn(r, [...COLS.qty]));
    if (!open || open <= 0) continue;
    const due = normalizeDate(pickColumn(r, [...COLS.promiseDate]));
    const list = transit.get(code) ?? [];
    list.push({ qty: open, plannedDate: due, overdue: !!due && due < bizDate, note: pickColumn(r, [...COLS.poNo]) });
    transit.set(code, list);
  }
  if (poLines.length && !hasColumn(poLines, [...COLS.promiseDate])) {
    warn("跟单表里没有「承诺到货日」列：在途到期判断退化为按需求日，逾期催货卡（T8）这一轮认不出来。回签拿到的交期要回填到这一列。");
  }
  if (production.length && poLines.length === 0) {
    warn("没有导跟单表/订单执行报表：有效在途按 0 算，缺口会算大；等确认、在途、逾期三条泳道这一轮是空的。");
  }

  const ctx: Ctx = { bizDate, now, mats, matCodes: [...mats.keys()], avail, transit, warn };
  const tasks: BoardTask[] = [];

  tasks.push(...fromProduction(production, ctx));
  tasks.push(...fromAddon(addon, ctx));
  tasks.push(...fromTracking(poLines, ctx));
  tasks.push(...fromArrivals(arrivals, ctx));
  tasks.push(...dailyCheck(ctx));

  // 同一张卡被两条来源命中时保留分高的那张（一张卡只能有一个家）
  const byId = new Map<string, BoardTask>();
  for (const t of tasks) {
    const prev = byId.get(t.id);
    if (!prev || t.score > prev.score) byId.set(t.id, t);
  }
  return { tasks: [...byId.values()], warnings };
}

/* ── T1 / T1-B / T3：生产表 ── */
function fromProduction(rows: Record<string, string>[], ctx: Ctx): BoardTask[] {
  if (!rows.length) return [];
  const out: BoardTask[] = [];
  if (!hasColumn(rows, [...COLS.needDate])) {
    ctx.warn("生产表里没有「需求日期」列：交期倒推没有起点，最晚下单日按今天 + 7 天粗估，只能当参考。让生产把需求日期列补上，这是倒推的起点。");
  }

  // 同一物料多行需求先按物料合并，再取最早的需求日——一个物料一天只出一张卡
  const merged = new Map<string, { code: string; qty: number; needDate?: string; rows: Record<string, string>[] }>();
  for (const r of rows) {
    const code = pickColumn(r, [...COLS.code]);
    if (!code) continue;
    const q = num(pickColumn(r, [...COLS.qty])) ?? 0;
    const nd = normalizeDate(pickColumn(r, [...COLS.needDate]));
    const cur = merged.get(code) ?? { code, qty: 0, needDate: undefined as string | undefined, rows: [] };
    cur.qty += q;
    if (nd && (!cur.needDate || nd < cur.needDate)) cur.needDate = nd;
    cur.rows.push(r);
    merged.set(code, cur);
  }

  for (const g of merged.values()) {
    const m = ctx.mats.get(g.code);
    const name = m?.name ?? pickColumn(g.rows[0], [...COLS.name]) ?? g.code;
    const needDate = g.needDate ?? fmt(addDays(parseDate(ctx.bizDate), 7));
    const level = demandLevelOf(m, g.needDate, ctx.bizDate);

    // ① 编码未命中 / 停购 / 警示 → 拦截确认
    if (ctx.matCodes.length && !m) {
      out.push(interceptCard(g.code, name, g.qty, needDate, "编码未命中", ctx, g.rows[0], level));
      continue;
    }
    if (m && (isBlockedStatus(m.status) || isWarnStatus(m.status))) {
      out.push(interceptCard(g.code, m.name, g.qty, needDate, m.status, ctx, g.rows[0], level));
      continue;
    }
    if (m && !isBuyable(m.status)) {
      out.push(interceptCard(g.code, m.name, g.qty, needDate, m.status, ctx, g.rows[0], level));
      continue;
    }

    // ② 算净缺口
    const trans = ctx.transit.get(g.code) ?? [];
    const calc = calcOrderQty({
      item: name,
      status: m?.status,
      demand: g.qty,
      available: ctx.avail.get(g.code) ?? 0,
      inTransit: trans,
      today: ctx.bizDate,
      daysUntilNeed: workdaysBetween(ctx.bizDate, needDate),
      moq: m?.moq,
      packUnit: m?.packUnit,
    });
    if (calc.verdict === "no_order" || calc.purchaseGap <= 0) continue;

    // ③ 交期倒推
    const sched = backwardSchedule({
      needDate,
      today: ctx.bizDate,
      transportDays: FALLBACK.transportDays,
      productionDays: FALLBACK.productionDays,
      expediteProductionDays: 3,
    });
    ctx.warn(`没有供应商档案：生产周期按 ${FALLBACK.productionDays} 天、运输 ${FALLBACK.transportDays} 天的通用值倒推，最晚下单日只能当参考。真实口径（自然日还是工作日、固定发车日、接单截止）要按 supplier-profiles 填进来，问不清就等着晚 2 天。`);

    const qty = calc.roundedQty ?? calc.purchaseGap;
    const amount = m?.price ? m.price * qty : undefined;
    const coverage = m?.dailyUsage ? ((ctx.avail.get(g.code) ?? 0) + calc.validTransit) / m.dailyUsage : undefined;
    const scoreIn: ScoreContext = {
      workdaysLeft: workdaysBetween(ctx.bizDate, sched.latestOrderDate),
      demandLevel: level,
      coverageDays: coverage,
      amount,
      onTimeRate: m?.onTimeRate,
      ageDays: 0,
      blockedBy: "production",
    };

    if (!sched.ok) {
      // T1-B：来不及了，要的是补救不是下单
      out.push(build({
        kind: "T1B_late", key: g.code,
        title: `找生产/领导定「${name}」的补救方案（最晚下单日 ${sched.latestOrderDate} 已过）`,
        materialCode: g.code, materialName: name, supplier: m?.supplier, qty, needDate, dueDate: ctx.bizDate,
        steps: [
          step("s1", `打给供应商问加急实际能压到几天、加多少钱——**要文字报价，不认口头**（常规周期最早 ${sched.alternatives?.earliestArrival.date ?? "—"} 到）`, "电话 + 微信留痕"),
          step("s2", `加急能赶上就走加急；加急费超你的权限，先发一条消息请示领导：金额 + 不加急的后果 + 你的建议`, "微信/邮件，抄送领导"),
          step("s3", `加急也不行 → 找生产给两个数字选：推迟 ${Math.max(1, -workdaysBetween(ctx.bizDate, sched.latestOrderDate))} 天，或先到一半先开线`, "面谈 + 书面确认"),
          step("s4", "拿到书面答复后回到「缺料下单」正常开单，或把这条作废关闭并写明理由", U8("供应链→采购管理→采购订单→增加")),
        ],
        doneRule: "有一条**书面**结论（领导批加急 / 生产同意改期 / 分批方案确认），且下单卡已恢复可执行或已作废关闭。口头答应不算。",
        escalation: `当天 16:00 还没拿到答复 → 电话追一遍 + 微信留痕：「X 总，${name}这条今天不定，明天就来不及了，麻烦您给个字。」`,
        score: { ...scoreIn, workdaysLeft: Math.min(-1, scoreIn.workdaysLeft), namedByBoss: false },
        sourceRow: g.rows[0],
      }, ctx));
      continue;
    }

    const moqNote = calc.moqOptions?.length ? `（缺口 ${calc.purchaseGap} 低于 MOQ ${m?.moq}，三选一你来定）` : "";
    out.push(build({
      kind: "T1_shortage", key: g.code,
      title: `下单「${name}」${qty}${moqNote}`,
      materialCode: g.code, materialName: name, supplier: m?.supplier, qty, needDate, dueDate: sched.latestOrderDate,
      steps: [
        step("s1", `核算式输入（不是重算，是核对）：可用量取的是"可用"不是"现存"？在途里逾期未决的 ${calc.overdueTransit} 剔干净了？——${calc.steps[0] ?? ""}`, "小采：净缺口算式"),
        ...(calc.moqOptions?.length ? [step("s2", `低于 MOQ，三选一：${calc.moqOptions.join(" ｜ ")}`, "你来定，小采不替你选")] : []),
        step("s3", `按 ${sched.formula} 倒推，最晚下单日 ${sched.latestOrderDate}，今天下来得及`, "小采：交期倒推"),
        step("s4", `开采购订单，一单一供应商；计划到货日填**供应商承诺日**不是需求日 ${needDate}`, U8("供应链→采购管理→采购订单→增加")),
        step("s5", "审核（保存 ≠ 生效）→ 导出发供应商 → 回看板填订单号，自动派生「等回签」卡", U8("采购订单→审核")),
      ],
      doneRule: `U8 订单号已回填、订单状态 = 已审核、且已派生一张「等回签」卡。光在 U8 保存不算完。`,
      escalation: `最晚下单日过了还没下 → 当天 17:00 前书面告知生产计划 + 抄送领导：「X 主任，${name}需求日 ${needDate}，按供应商常规 ${FALLBACK.productionDays} 天周期今天下单最早 ${sched.alternatives?.earliestArrival.date ?? "—"} 到。两个方案：A 走加急（加价约 15%，需您批）；B 生产计划这批往后挪。您定一个，我今天下班前照办。」`,
      score: scoreIn,
      sourceRow: g.rows[0],
    }, ctx));
  }
  return out;
}

function interceptCard(code: string, name: string, qty: number, needDate: string, status: string, ctx: Ctx, row: Record<string, string>, level: ScoreContext["demandLevel"]): BoardTask {
  const unknown = status === "编码未命中";
  const near = unknown ? nearestCodes(code, ctx.matCodes) : [];
  const question = unknown
    ? `这个编码 ${code} 在我管的 152 项里查不到。是新料还是编码写错了？最相近的三个是 ${near.join(" / ") || "（物料表为空）"}，你核一下给我一个准的编码。`
    : /停购|下架/.test(status)
      ? `${name}（${code}）系统里标的是「${status}」，我不能直接下。是要复用旧包材，还是有新编码替代？给我一句话我照着办。`
      : `${name}（${code}）系统里标的是「${status}」，下之前想跟你确认一下这个料还在用吗？确认还在用我就下，量我先按保守的报。`;
  return build({
    kind: "T3_intercept", key: code,
    title: `找生产确认「${name}」怎么办（${status}）`,
    materialCode: code, materialName: name, qty, needDate, dueDate: needDate,
    steps: [
      step("s1", `把这条归堆：${unknown ? "编码未命中——不猜、不借用相近编码" : /停购|下架/.test(status) ? "停购类——不下单，先反问" : "警示类——先确认物料还活着，确认活着才下且量放保守"}`, "小采：拦截清单"),
      step("s2", `发给提出人，原话照抄：「${question}」`, "微信/邮件，要文字回复"),
      step("s3", "答复回来记进卡片：下 / 不下 / 换编码 XXX。能下的转成下单卡，不能下的关闭并更新物料表状态", "看板 + 物料表"),
    ],
    doneRule: "清单已发出（有发送记录）**且**这一行有一个书面答复（下 / 不下 / 换编码 XXX）。只发出没回话 = 未完成。",
    escalation: `发出 24 小时无人回 → 电话找提出人；48 小时无人回 → 抄送双方领导，正文写清「不确认默认按不下单处理，若因此缺料请提前知晓」。给默认值 + 截止时间，是逼决策最有效的一招。`,
    score: {
      workdaysLeft: workdaysBetween(ctx.bizDate, needDate),
      demandLevel: level,
      blockedBy: "production",
      ageDays: 0,
      quickWin: true,
    },
    sourceRow: row,
  }, ctx);
}

/* ── T2：加单 ── */
function fromAddon(rows: Record<string, string>[], ctx: Ctx): BoardTask[] {
  if (!rows.length) return [];
  const out: BoardTask[] = [];
  if (!hasColumn(rows, [...COLS.authorizedBy]) && !hasColumn(rows, [...COLS.evidence])) {
    ctx.warn("加单表里没有「授权人 / 授权凭据」列：所有加单一律先当「无书面授权」处理，拿到文字前不下单。这两列是加单和常规单的唯一实质区别。");
  }
  for (const r of rows) {
    const code = pickColumn(r, [...COLS.code]);
    if (!code) continue;
    const m = ctx.mats.get(code);
    const name = m?.name ?? pickColumn(r, [...COLS.name]) ?? code;
    const qty = num(pickColumn(r, [...COLS.qty])) ?? 0;
    const needDate = normalizeDate(pickColumn(r, [...COLS.needDate])) ?? ctx.bizDate;
    const requester = pickColumn(r, [...COLS.requester]) || "提出人未填";
    const authorized = pickColumn(r, [...COLS.authorizedBy]);
    const evidence = pickColumn(r, [...COLS.evidence]);
    const hasAuth = !!authorized && !!evidence;
    const urgent = /1|是|急|y/i.test(pickColumn(r, [...COLS.urgent]));

    out.push(build({
      kind: "T2_addon", key: `${code}#${requester}`,
      title: hasAuth ? `照加单下「${name}」${qty}（${requester} 提，${authorized} 批）` : `先向 ${requester} 要「${name}」加单的书面授权`,
      materialCode: code, materialName: name, supplier: m?.supplier, qty, needDate,
      // 加单天然时间紧：最晚动作日按需求日往前半天算，不留过夜
      dueDate: ctx.bizDate,
      steps: [
        step("s1", hasAuth
          ? `授权已齐（${authorized} / 凭据：${evidence}），凭据截图挂在这张卡上`
          : `回一句：「${requester}，这个加单麻烦你在群里发条文字，我照着下。」**拿到文字前不下单**`, "微信，要文字"),
        step("s2", "照常规单算一遍账：可用量、有效在途、净缺口——急单最容易重复下，这一步一次都不能跳", "小采：净缺口算式"),
        step("s3", "优先原供应商原价格加单；赶不上再谈备选或加急（加价先请示领导）", "电话供应商"),
        step("s4", `**新开一张 PO，不改已审核的原订单**；备注写「加单，来源：${needDate} ${requester}微信；对应原订单 XXX」`, U8("供应链→采购管理→采购订单→增加")),
        step("s5", "当天审核 + 发出 + 要回签；跟单表标「急」", U8("采购订单→审核")),
      ],
      doneRule: "PO 已审核、备注含加单来源、已派生「等回签」卡，且授权凭据文件已挂在这张卡上。三样缺一样都不算完。",
      escalation: `授权要不到 → 24 小时后关闭这条并回一句：「这条加单我没收到书面，先没下。要下随时告诉我。」**抄送自己领导**——这不是甩锅，是留痕。`,
      score: {
        workdaysLeft: hasAuth ? 0 : -1,
        demandLevel: demandLevelOf(m, needDate, ctx.bizDate),
        amount: m?.price ? m.price * qty : undefined,
        onTimeRate: m?.onTimeRate,
        blockedBy: "production",
        ageDays: 0,
        quickWin: !hasAuth,
        namedByBoss: urgent,
      },
      sourceRow: r,
    }, ctx));
  }
  return out;
}

/* ── T4 / T5 / T7 / T8 / T6：跟单表 ── */
function fromTracking(rows: Record<string, string>[], ctx: Ctx): BoardTask[] {
  if (!rows.length) return [];
  const out: BoardTask[] = [];
  for (const r of rows) {
    const st = pickColumn(r, [...COLS.trackStatus]);
    if (isClosedStatus(st)) continue;
    const code = pickColumn(r, [...COLS.code]);
    const m = ctx.mats.get(code);
    const name = m?.name ?? pickColumn(r, [...COLS.name]) ?? code;
    const poNo = pickColumn(r, [...COLS.poNo]) || "（订单号未填）";
    const supplier = pickColumn(r, [...COLS.supplier]) || m?.supplier;
    const qty = num(pickColumn(r, [...COLS.openQty])) ?? num(pickColumn(r, [...COLS.qty]));
    const due = normalizeDate(pickColumn(r, [...COLS.promiseDate]));
    const signed = normalizeDate(pickColumn(r, [...COLS.signedBack]));
    const tracking = pickColumn(r, ["物流单号", "运单号", "快递单号"]);
    const level = demandLevelOf(m, due, ctx.bizDate);
    const amount = m?.price && qty ? m.price * qty : undefined;
    const coverage = m?.dailyUsage ? (ctx.avail.get(code) ?? 0) / m.dailyUsage : undefined;
    const base = { materialCode: code || undefined, materialName: name, supplier, poNo, qty, promiseDate: due };
    const lateDays = due ? -workdaysBetween(ctx.bizDate, due) : 0;

    // ① 已到待入库 → T7（货躺在门口，账上没库存，生产领不出料）
    if (st === "已到待入库") {
      out.push(build({
        kind: "T7_not_stocked", key: `${poNo}#${code}`,
        title: `催仓库把「${name}」${poNo} 的入库单录了并审核`,
        ...base, dueDate: ctx.bizDate,
        steps: [
          step("s1", "先分清卡在哪，四选一：货没到 / 到了没录到货单 / 录了没审核 / 卡在质检——别笼统说「没入库」", "问仓库对接人"),
          step("s2", "把送货单照片和订单号一起发过去，让对方不用找", "微信发仓库群"),
          step("s3", "卡质检的催质检出结论；不合格的立刻开一张差异卡", "找质检"),
          step("s4", "入库单审核后核对累计入库增量 = 本次实到量", U8("采购管理→采购订单执行情况统计表→累计入库列")),
        ],
        doneRule: "U8「累计入库」增量 = 本次实到量，且跟单表入库量列已按 U8 回填。以 U8 为准，不认口头「入了」。",
        escalation: `滞留 2 天 → 找仓库主管而不是经办人：「X 主管，${poNo} 的货已经到了，系统里还没入库，生产那边领不出料。是不是缺什么资料？我这边补给您。」（把话说成"我来配合"，不是"你怎么还没弄"）`,
        score: { workdaysLeft: 0, demandLevel: level, coverageDays: coverage, amount, onTimeRate: m?.onTimeRate, blockedBy: "warehouse", ageDays: Math.max(0, lateDays), quickWin: true },
        sourceRow: r,
      }, ctx));
      continue;
    }

    // ② 逾期 → T8（打电话问三样，缺一样等于没打）
    if (due && due < ctx.bizDate) {
      out.push(build({
        kind: "T8_overdue", key: `${poNo}#${code}`,
        title: `催「${name}」${poNo} 的新交期（已逾期 ${lateDays} 天）`,
        ...base, dueDate: due,
        steps: [
          step("s1", "打电话问三样，缺一样等于没打：**为什么晚 / 新交期哪天 / 现在货到哪一步了**", `电话 ${supplier ?? "供应商"}`),
          step("s2", `当场判断新交期还赶不赶得上；赶不上立刻转「来不及」卡找替代方案`, "小采：交期倒推"),
          step("s3", "**当天**通知生产/计划——延误影响别人排产，瞒着只会把小事拖成事故", "微信/邮件，留发送记录"),
          step("s4", `跟进记录写「${ctx.bizDate} 电话 XXX：原话 …… 新交期 X/X」，新交期回填跟单表承诺交期列`, "看板记一笔 + 跟单表"),
        ],
        doneRule: "有新交期（已写进跟单表）**且**生产已被书面告知（有发送记录）。只打了电话没通知生产 = 未完成。",
        escalation: `同一件事催三次没结果就换轨，不做第四次：改邮件 + 抄送对方销售上级 + 自己领导。「X 经理：${poNo}（${name}）原定 ${due} 到货，至今未交，我方已三次电话确认未获明确答复。请于明日 12:00 前书面回复确切发货日；逾期我方将启动备选供应商并按合同条款处理。」`,
        score: { workdaysLeft: -Math.max(1, lateDays), demandLevel: level, coverageDays: coverage, amount, onTimeRate: m?.onTimeRate, blockedBy: "production", ageDays: Math.max(0, lateDays), quickWin: true },
        sourceRow: r,
      }, ctx));
      continue;
    }

    // ③ 未回签 → T4（全流程最常被跳过的一步）
    if (!signed && (st === "未发货" || st === "")) {
      out.push(build({
        kind: "T4_unconfirmed", key: `${poNo}#${code}`,
        title: `要「${name}」${poNo} 的书面回签（数量 + 每批到货日）`,
        ...base, dueDate: ctx.bizDate,
        steps: [
          step("s1", "先微信问一句「收到了吗」——只确认收到，不聊别的", `微信 ${supplier ?? "供应商"}`),
          step("s2", "要回签件，四项缺一不可：数量 / 单价 / 分批计划 / 每批到货日", "微信/邮件要图片或 PDF"),
          step("s3", `回签交期与 PO 上的 ${due ?? "计划到货日"} 不一致 → 不是"知道了"，是回去重新倒推：新交期还赶得上需求日吗？赶不上立刻转「来不及」卡`, "小采：交期倒推"),
          step("s4", "回签件存进这张卡；跟单表「承诺交期」列以回签为准回填", "看板附件 + 跟单表"),
        ],
        doneRule: "卡片附件里有回签件（图片/PDF/明确的文字确认皆可）**且**承诺交期已按回签回填。供应商回一句「好的」不算回签——回签必须含日期和数量。",
        escalation: `48 小时未回签 → 换轨发邮件（不是微信），主题「${poNo} 交期书面确认（限明日 12:00 前回复）」，抄送对方销售主管 + 自己领导：「张经理，${poNo} 我方发出至今未收到书面回签。请于明日 12:00 前书面确认数量与到货日期；逾期未复我方将视为无法满足交期，启动备选方案。」`,
        score: { workdaysLeft: 0, demandLevel: level, coverageDays: coverage, amount, onTimeRate: m?.onTimeRate, blockedBy: "none", ageDays: 1, quickWin: true },
        sourceRow: r,
      }, ctx));
      continue;
    }

    // ④ 其余在途 → T5
    const left = due ? workdaysBetween(ctx.bizDate, due) : 5;
    out.push(build({
      kind: "T5_transit", key: `${poNo}#${code}`,
      title: tracking
        ? `盯「${name}」${poNo} 的物流节点（承诺 ${due ?? "—"} 到）`
        : `向 ${supplier ?? "供应商"} 要「${name}」${poNo} 的运单号`,
      ...base, dueDate: due ? fmt(addDays(parseDate(due), -1)) : undefined,
      steps: [
        step("s1", `三色判定：距承诺交期 ${left} 个工作日${left <= 3 ? "，已进临期，今天就要问" : "，还有余量，每周确认一次即可"}`, "小采：订单跟踪"),
        step("s2", "要三样才算「已发货」：**物流公司 + 运单号 + 预计到达日**，缺一样就不算", `电话/微信 ${supplier ?? "供应商"}`),
        step("s3", `运单号进跟单表${tracking ? `（现在是 ${tracking}）` : "（现在还没有）"}，看物流节点；停滞 ≥ 2 天供应商 + 物流两头催`, "跟单表"),
        step("s4", "预计延误就立刻改到货预告并通知仓库和生产——别等货真的没到才说", "微信仓库群 + 生产"),
      ],
      doneRule: "状态推进到「已到待入库」，或跟单表物流单号列非空且有预计到达日（未发货状态除外）。",
      escalation: `物流停滞 2 天 → 要司机电话直接问；3 天 → 书面通知供应商「若 X 日前不能到货，我方按缺料处理并保留追责」，抄送领导。`,
      score: { workdaysLeft: left, demandLevel: level, coverageDays: coverage, amount, onTimeRate: m?.onTimeRate, blockedBy: "none", ageDays: 0, quickWin: !tracking },
      sourceRow: r,
    }, ctx));
  }

  // ⑤ T6 明日到货预告：每天一张，固定动作
  const notice = arrivalNotice(rows, ctx.bizDate);
  if (notice.lines.length) {
    const urgent = notice.lines.filter((l) => l.urgent).length;
    out.push(build({
      kind: "T6_notice", key: notice.targetDate,
      title: `发明日到货预告给仓库（${notice.lines.length} 单${urgent ? `，其中 ${urgent} 单急料` : ""}）`,
      dueDate: ctx.bizDate,
      steps: [
        step("s1", "六列表已生成，核一眼数量和物料对不对", "小采：到货预告"),
        step("s2", "状态还是「未发货」的行，今天先找供应商要运单号；要不到的在表里标「待确认」", "电话供应商"),
        step("s3", "需检验的料同时通知质检——别等货到了才想起报检", "微信质检"),
        step("s4", "发仓库群 **@到具体的人**，不发「各位」", "微信仓库群"),
      ],
      doneRule: "已发送**且**仓库有人回复确认（回「收到」即可）。没人回 = 没发出。",
      escalation: `17:00 仓库没人回 → 打电话给仓库对接人：「X 哥，明天有 ${notice.lines.length} 单到${urgent ? "，其中有急料" : ""}，麻烦到了先点数当天录单。表我发群里了，你看一下。」`,
      score: { workdaysLeft: 0, demandLevel: urgent ? "daily" : "week", blockedBy: "warehouse", ageDays: 0, quickWin: true },
    }, ctx));
  }
  return out;
}

/* ── T9 / T7：到货表 ── */
function fromArrivals(rows: Record<string, string>[], ctx: Ctx): BoardTask[] {
  if (!rows.length) return [];
  const out: BoardTask[] = [];
  const hasReceived = hasColumn(rows, [...COLS.receivedQty]);
  if (!hasReceived) {
    ctx.warn("到货表里没有「实到数量 / 累计到货」列：数量差异（欠交/超交）判不出来，差异卡这一轮出不来。这是当天必须闭环的事，列要补上。");
  }
  for (const r of rows) {
    const code = pickColumn(r, [...COLS.code]);
    const m = ctx.mats.get(code);
    const name = m?.name ?? pickColumn(r, [...COLS.name]) ?? code;
    const poNo = pickColumn(r, [...COLS.poNo]) || "（订单号未填）";
    const supplier = pickColumn(r, [...COLS.supplier]) || m?.supplier;
    const ordered = num(pickColumn(r, ["订单数量", "应到数量", "数量"]));
    const received = num(pickColumn(r, [...COLS.receivedQty]));
    const stocked = num(pickColumn(r, [...COLS.stockedQty]));
    const inspect = pickColumn(r, [...COLS.inspect]);
    const level = demandLevelOf(m, undefined, ctx.bizDate);
    const badInspect = /不合格|让步/.test(inspect);
    const diff = ordered !== undefined && received !== undefined ? received - ordered : undefined;

    if ((diff !== undefined && diff !== 0) || badInspect) {
      const kindWord = badInspect ? (/让步/.test(inspect) ? "让步接收" : "质检不合格") : diff! < 0 ? `欠交 ${-diff!}` : `超交 ${diff!}`;
      const ratio = diff !== undefined && ordered ? Math.abs(diff) / ordered : 0;
      out.push(build({
        kind: "T9_discrepancy", key: `${poNo}#${code}`,
        title: `定性「${name}」${poNo} 的到货差异（${kindWord}）`,
        materialCode: code || undefined, materialName: name, supplier, poNo, qty: received, dueDate: ctx.bizDate,
        steps: [
          step("s1", `归类：${kindWord}。数量差 ${diff ?? 0}（订单 ${ordered ?? "—"} / 实到 ${received ?? "—"}，差异比例 ${(ratio * 100).toFixed(1)}%）`, "小采：差异分类"),
          step("s2", "**当天**拍照留证 + 书面通知供应商（微信文字也行，但要有时间戳）", `微信 ${supplier ?? "供应商"}`),
          step("s3", diff !== undefined && diff < 0
            ? "欠交：要一个补货日期，订单行保持开放；供应商明确不补才手工关闭该行"
            : diff !== undefined && diff > 0
              ? "超交：先查公司允不允许超收；不收的当场拒收，要收的**先请示再收**，别自作主张"
              : "不合格/让步接收：好的部分正常入库，不良明细发供应商要补货或扣款，让步接收要书面结论",
            U8("采购管理→采购订单→手工关闭订单行")),
          step("s4", "两边同步：仓库（账实一致）+ 供应商（责任归属）。拖过三天就说不清了", "仓库群 + 供应商"),
        ],
        doneRule: "差异量有明确去向（补货日期 / 退回 / 关闭行 / 让步接收书面结论），**且**供应商与仓库两边都有书面记录。",
        escalation: `差异 3 天未定性 → 上报领导定调：「X 总，${poNo} 到货${kindWord}，供应商说下周补，但生产要用。我建议 A：让他先空运补；B：从别的仓调。您看哪个？」`,
        score: {
          workdaysLeft: 0, demandLevel: level,
          amount: m?.price && diff ? m.price * Math.abs(diff) : undefined,
          onTimeRate: m?.onTimeRate, blockedBy: "warehouse", ageDays: 0,
          namedByBoss: false,
          stockedOut: false,
        },
        sourceRow: r,
      }, ctx));
      continue;
    }

    // 到了但累计入库没涨 → T7
    if (received !== undefined && stocked !== undefined && received > stocked) {
      out.push(build({
        kind: "T7_not_stocked", key: `${poNo}#${code}`,
        title: `催「${name}」${poNo} 的入库单（到货 ${received}，累计入库才 ${stocked}）`,
        materialCode: code || undefined, materialName: name, supplier, poNo, qty: received - stocked, dueDate: ctx.bizDate,
        steps: [
          step("s1", "四选一分清卡在哪：货没到 / 到了没录到货单 / 录了没审核 / 卡在质检", "问仓库对接人"),
          step("s2", "把送货单照片和订单号一起发过去，让对方不用找", "微信仓库群"),
          step("s3", `核对累计入库增量：现在差 ${received - stocked}`, U8("采购管理→采购订单执行情况统计表→累计入库列")),
        ],
        doneRule: "U8「累计入库」增量 = 本次实到量，且跟单表入库量列已按 U8 回填。以 U8 为准，不认口头「入了」。",
        escalation: `滞留 2 天 → 找仓库主管：「X 主管，${poNo} 的货已经到了，系统里还没入库，生产那边领不出料。是不是缺什么资料？我这边补给您。」`,
        score: { workdaysLeft: 0, demandLevel: level, amount: m?.price ? m.price * (received - stocked) : undefined, blockedBy: "warehouse", ageDays: 1, quickWin: true },
        sourceRow: r,
      }, ctx));
    }
  }
  return out;
}

/* ── T10：日配件水位巡检（她岗位的命门） ── */
function dailyCheck(ctx: Ctx): BoardTask[] {
  const out: BoardTask[] = [];
  for (const m of ctx.mats.values()) {
    if (!isDaily(m)) continue;
    const available = ctx.avail.get(m.code) ?? 0;
    const trans = ctx.transit.get(m.code) ?? [];
    const valid = trans.filter((t) => !t.overdue).reduce((s, t) => s + t.qty, 0);
    const coverage = m.dailyUsage ? (available + valid) / m.dailyUsage : undefined;
    const covText = coverage === undefined
      ? "日均用量没填，覆盖天数算不出来——先去物料表把日均用量补上，这是分母"
      : `覆盖 ${coverage.toFixed(1)} 天 =（可用 ${available} + 有效在途 ${valid}）÷ 日均 ${m.dailyUsage}`;
    const red = coverage !== undefined && coverage < 3;
    out.push(build({
      kind: "T10_daily_check", key: m.code,
      title: red ? `处理「${m.name}」水位告警（只够 ${coverage!.toFixed(1)} 天，< 3 天红线）` : `录「${m.name}」今日水位（${coverage === undefined ? "缺日均用量" : `${coverage.toFixed(1)} 天`}）`,
      materialCode: m.code, materialName: m.name, supplier: m.supplier, dueDate: ctx.bizDate,
      steps: [
        step("s1", `算覆盖天数：${covText}`, "小采：水位算式"),
        step("s2", "< 3 天 → 先查他仓可调量，能调先调（调拨比下单快）", U8("库存管理→现存量查询（按仓库）")),
        step("s3", "调不到 → 联系供应商问最快到货日，同时通知生产「X 日可能断」", "电话供应商 + 微信生产"),
        step("s4", "把今天的水位数字报一次给生产/领导——这既是防断料，也是让你的工作被看见", "微信"),
      ],
      doneRule: "今日水位数字已录；覆盖天数 < 3 天的，有一个**已执行**的动作（调拨单号 / 催货记录 / 通知生产的发送记录）。",
      escalation: `覆盖 < 1 天 → 立刻电话生产主管 + 领导，不用等下班：「X 总，${m.name}现在只够半天，供应商最快明天下午到，中间可能缺几小时。我已经让 B 仓调货今天下午到，先顶上。跟您报备一声。」（先说结论，再说已经做了什么，最后才是求助）`,
      score: {
        workdaysLeft: coverage === undefined ? 0 : Math.max(-2, Math.floor(coverage) - 1),
        demandLevel: "daily",
        coverageDays: coverage,
        stockedOut: coverage !== undefined && coverage <= 0,
        onTimeRate: m.onTimeRate,
        blockedBy: "production",
        ageDays: 0,
        quickWin: !red,
      },
    }, ctx));
  }
  return out;
}
