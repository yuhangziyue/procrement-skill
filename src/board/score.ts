// 任务打分。公式出自采姐 spec-cai.md §3，硬规则 R1 出自苏姐 spec-su.md §4。
//
//   score = 35·f_time + 30·f_stock + 12·f_daily + 8·f_amount + 8·f_supplier + 7·f_aging + bonus
//   ≥75 → P0 / 50~74 → P1 / 25~49 → P2 / <25 → P3
//
// 两条设计约束，别绕过：
// ① 每个因子都要给一句人话 why——卡片上「为什么排第一」直接渲染这段，算不出理由的分不许显示（苏姐铁律①）。
// ② 分数必须能被质疑：factors[] 的 points 之和 = 基础分，R1 的 +100 只记在 rules[]，
//    所以 score − Σfactors.points 就是硬规则加的那部分，一眼能对出来。
import type { ScoreBreakdown, ScoreInput } from "./types";

/** 六因子权重（采姐 §3.1）。时间 + 断料占 65 分，金额只占 8 分——就是要纠正「金额大的先做」。 */
export const WEIGHTS = { time: 35, stock: 30, daily: 12, amount: 8, supplier: 8, aging: 7 } as const;

/** 分档阈值（采姐 §3.2） */
export const THRESHOLDS = { P0: 75, P1: 50, P2: 25 } as const;

/** 已实际断料停线的硬加分（采姐 §3.1 bonus 行） */
export const BONUS_STOCKED_OUT = 40;
/** 苏姐 R1：逾期 + 断线料，强制置顶 */
export const RULE_R1_BONUS = 100;

/**
 * scoreTask 的入参。它是 ScoreInput 的**兼容超集**：多出来的几个字段全可选，
 * 直接传一个 ScoreInput 依然合法（types.ts 一个字没改）。
 * 加这几个字段的原因：ScoreInput 里没有「覆盖天数」，而采姐的 f_stock 是按覆盖天数算的；
 * generate.ts 手上有现存量和日均用量，真算得出来，不该退化成按 demandLevel 猜。
 */
export interface ScoreContext extends ScoreInput {
  /** 覆盖天数 =（可用量 + 有效在途）÷ 日均用量。给了就用真数，不给才按 demandLevel 兜底 */
  coverageDays?: number;
  /** 订单金额已知但为 0 时，和「不知道金额」要区分开——这里显式说明金额来源 */
  amountKnown?: boolean;
  /** 生产或领导书面点名催（采姐 §3.1 bonus +15） */
  namedByBoss?: boolean;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const r1 = (v: number) => Math.round(v * 10) / 10;
const r2 = (v: number) => Math.round(v * 100) / 100;

/** demandLevel → 覆盖天数缺失时的 f_stock 兜底值。数值取自采姐三个算例反解出来的覆盖天数。 */
const STOCK_BY_LEVEL: Record<ScoreInput["demandLevel"], { value: number; why: string }> = {
  daily: { value: 0.95, why: "日配件按「库存只够半天」的口径估断料风险（缺日均用量，按最坏算）" },
  week: { value: 0.6, why: "本周排产要用，按覆盖 4 天估（没有日均用量就不敢往乐观了估）" },
  next: { value: 0.4, why: "下周排产，按覆盖 6 天估" },
  refill: { value: 0.1, why: "安全库存补货，短期不会断，取下限 0.1" },
};

const LEVEL_OF = (score: number): ScoreBreakdown["level"] =>
  score >= THRESHOLDS.P0 ? "P0" : score >= THRESHOLDS.P1 ? "P1" : score >= THRESHOLDS.P2 ? "P2" : "P3";

/** 分档的一句人话，给横幅和卡片角标用 */
export function levelText(level: ScoreBreakdown["level"]): string {
  return {
    P0: "🔴 P0 今天必须闭环，下班前没闭环要走升级动作并写明原因",
    P1: "🟡 P1 今天必须有一个动作（打了电话 / 发了邮件），不要求闭环",
    P2: "🟢 P2 本周内处理",
    P3: "⚪ P3 观察区，周五扫一遍",
  }[level];
}

export function scoreTask(input: ScoreContext): ScoreBreakdown {
  const factors: ScoreBreakdown["factors"] = [];
  const rules: string[] = [];

  // ── f_time 时间压力：slack = 距最晚动作日的工作日数 ────────────────────────
  const slack = input.workdaysLeft;
  const fTime = slack <= 0 ? 1 : clamp(1 - slack / 12, 0.1, 1);
  factors.push({
    key: "f_time",
    label: "时间压力",
    weight: WEIGHTS.time,
    value: r2(fTime),
    points: r1(WEIGHTS.time * fTime),
    why:
      slack < 0
        ? `最晚动作日已经过去 ${-slack} 个工作日，时间分顶格——晚一天都不会自己变好`
        : slack === 0
          ? "最晚动作日就是今天，今天不动就来不及，时间分顶格"
          : `距最晚动作日还有 ${slack} 个工作日（工作日口径，节假日不算）`,
  });

  // ── f_stock 断料风险 ──────────────────────────────────────────────────────
  let fStock: number;
  let stockWhy: string;
  if (input.stockedOut) {
    fStock = 1;
    stockWhy = "已经断料/停线，断料分顶格——这条不解决今天别干别的";
  } else if (input.coverageDays !== undefined) {
    const cov = input.coverageDays;
    fStock = cov <= 0 ? 1 : clamp(1 - cov / 10, 0.1, 1);
    stockWhy =
      cov <= 0
        ? "覆盖天数已经 ≤ 0，账上就是断的"
        : `库存 + 有效在途只够 ${r1(cov)} 天（覆盖天数 =（可用量 + 有效在途）÷ 日均用量）`;
  } else {
    const f = STOCK_BY_LEVEL[input.demandLevel];
    fStock = f.value;
    stockWhy = f.why;
  }
  factors.push({ key: "f_stock", label: "断料风险", weight: WEIGHTS.stock, value: r2(fStock), points: r1(WEIGHTS.stock * fStock), why: stockWhy });

  // ── f_daily 是否日配件 ────────────────────────────────────────────────────
  const fDaily = input.demandLevel === "daily" ? 1 : 0;
  factors.push({
    key: "f_daily",
    label: "日配件",
    weight: WEIGHTS.daily,
    value: fDaily,
    points: r1(WEIGHTS.daily * fDaily),
    why: fDaily ? "日配件：断一天停一条线，单独再加 12 分" : "非日配件，不加这 12 分",
  });

  // ── f_amount 金额（只值 8 分） ────────────────────────────────────────────
  const amount = input.amount;
  const fAmount = amount && amount > 0 ? clamp(Math.log10(amount / 1000) / 2, 0, 1) : 0;
  factors.push({
    key: "f_amount",
    label: "金额",
    weight: WEIGHTS.amount,
    value: r2(fAmount),
    points: r1(WEIGHTS.amount * fAmount),
    why:
      amount && amount > 0
        ? `订单金额约 ${Math.round(amount).toLocaleString("zh-CN")} 元（1 千元→0 分，10 万元→满 8 分；金额只值 8 分，别被大数字牵着走）`
        : "金额未知，按 0 分算——金额本来就只值 8 分，不猜",
  });

  // ── f_supplier 供应商风险 ─────────────────────────────────────────────────
  const rate = input.onTimeRate ?? 0.8;
  const fSupplier = clamp((0.95 - rate) / 0.25, 0, 1);
  factors.push({
    key: "f_supplier",
    label: "供应商风险",
    weight: WEIGHTS.supplier,
    value: r2(fSupplier),
    points: r1(WEIGHTS.supplier * fSupplier),
    why:
      input.onTimeRate === undefined
        ? "这家没有准交率档案，按 0.8 的保守值算——没数据不等于没风险"
        : `这家近 90 天准交率 ${Math.round(rate * 100)}%（0.95 以上不扣分，0.70 以下扣满）`,
  });

  // ── f_aging 任务停滞：防止难啃的任务永远沉底 ──────────────────────────────
  const age = input.ageDays ?? 0;
  const fAging = clamp(age / 5, 0, 1);
  factors.push({
    key: "f_aging",
    label: "任务停滞",
    weight: WEIGHTS.aging,
    value: r2(fAging),
    points: r1(WEIGHTS.aging * fAging),
    why: age > 0 ? `这条已经躺了 ${age} 天，每躺一天自动往上顶一点，躺满 5 天加满 7 分` : "今天新建的卡，还没被冷落",
  });

  // ── bonus 硬加分（采姐 §3.1）。记成 weight=0 的因子，方便卡片上和六因子一起列 ──
  if (input.stockedOut) {
    factors.push({ key: "bonus_stockout", label: "已断料停线", weight: 0, value: 1, points: BONUS_STOCKED_OUT, why: `已经断料停线，硬加 ${BONUS_STOCKED_OUT} 分` });
    rules.push("已实际断料停线：硬加 40 分（采姐 §3.1）");
  }
  if (input.namedByBoss) {
    factors.push({ key: "bonus_named", label: "被书面点名催", weight: 0, value: 1, points: 15, why: "生产或领导已经书面点名催这条，硬加 15 分" });
    rules.push("生产/领导书面点名催：硬加 15 分（采姐 §3.1）");
  }
  // 苏姐 §4 的 B（阻塞）与 Q（快赢）两个因子在采姐公式里没有位置，
  // 这里折成小额 bonus 保留，权重压得很低——不让它们动摇「时间 + 断料」的主导地位。
  const blockBonus = { none: 0, finance: 1, warehouse: 3, production: 6 }[input.blockedBy ?? "none"];
  if (blockBonus) {
    const who = { none: "", finance: "财务对账", warehouse: "仓库收货", production: "生产排产" }[input.blockedBy ?? "none"];
    factors.push({ key: "bonus_blocked", label: "卡着别人", weight: 0, value: 1, points: blockBonus, why: `这条卡着${who}，不是只卡自己，加 ${blockBonus} 分` });
  }
  if (input.quickWin) {
    factors.push({ key: "bonus_quickwin", label: "快赢", weight: 0, value: 1, points: 3, why: "一个电话/一次复制粘贴 5 分钟能闭环，顺手做掉，加 3 分" });
  }

  const base = factors.reduce((s, f) => s + f.points, 0);
  let score = base;

  // ── R1（苏姐 §4）：逾期 且 断线料 → 强制置顶 +100 ─────────────────────────
  // 口径收紧为「日配件 或 已断料」：苏姐原文写 S ≥ 0.7（含"本周要用"），
  // 但那样采姐算例 C（贴纸逾期 3 天、本周用、还有 4 天库存）会从 P1 被顶成 P0，
  // 与她「逾期本身不决定顺序，逾期会不会断料才决定」的结论直接打架。取交集：只认日配 + 已断料。
  const isLifeline = input.demandLevel === "daily" || input.stockedOut === true;
  if (slack < 0 && isLifeline) {
    score += RULE_R1_BONUS;
    rules.push(`R1 置顶：已逾期 ${-slack} 个工作日${input.stockedOut ? "且已断料" : "且是日配件"}，强制 +${RULE_R1_BONUS} 顶到「今天三件事」，公式再怎么算都不许把它挤下去`);
  }

  return { score: r1(score), level: LEVEL_OF(score), factors, rules };
}

/** 把 factors 折成卡片上的 reasons[]（人话版本，一行一条） */
export function reasonsOf(b: ScoreBreakdown): string[] {
  return [
    ...b.factors.filter((f) => f.points > 0).map((f) => `${f.label} ${f.value} × ${f.weight || "加分"} = ${f.points} 分：${f.why}`),
    ...b.rules,
    `合计 ${b.score} 分 → ${levelText(b.level)}`,
  ];
}
