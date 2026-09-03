// 打分的回归测试。三个算例直接抄采姐 spec-cai.md §3.3，允许 ±1.5 的误差
// （她表里的因子值是四舍五入到两位再乘的，和代码里全精度算出来会差零点几）。
import { describe, expect, it } from "vitest";
import { BONUS_STOCKED_OUT, RULE_R1_BONUS, levelText, reasonsOf, scoreTask, type ScoreContext } from "./score";

/** 基础分 = 六因子 + bonus，不含 R1 的 +100（R1 只记在 rules[]，方便对账） */
const base = (b: ReturnType<typeof scoreTask>) => b.factors.reduce((s, f) => s + f.points, 0);

/** 算例 A · 三拼腰封AL（日配件）：最晚下单日已过、库存只够半天 */
const CASE_A: ScoreContext = { workdaysLeft: -1, demandLevel: "daily", coverageDays: 0.5, amount: 8000, onTimeRate: 0.9, ageDays: 1 };
/** 算例 B · 纸盒大单 12 万元，距最晚下单日 4 天，库存够 15 天 */
const CASE_B: ScoreContext = { workdaysLeft: 4, demandLevel: "refill", coverageDays: 15, amount: 120000, onTimeRate: 0.85, ageDays: 0 };
/** 算例 C · 普通贴纸，供应商逾期 3 天没给说法，库存够 4 天 */
const CASE_C: ScoreContext = { workdaysLeft: -3, demandLevel: "week", coverageDays: 4, amount: 15000, onTimeRate: 0.78, ageDays: 3 };

describe("采姐 §3.3 三个算例", () => {
  it("算例 A 三拼腰封AL：基础分 82.1，档位 P0", () => {
    const b = scoreTask(CASE_A);
    expect(base(b)).toBeCloseTo(82.1, 0);
    expect(Math.abs(base(b) - 82.1)).toBeLessThanOrEqual(1.5);
    expect(b.level).toBe("P0");
  });

  it("算例 B 纸盒大单 12 万：基础分 37.5，档位 P2——金额是 C 的 8 倍照样排最后", () => {
    const b = scoreTask(CASE_B);
    expect(Math.abs(base(b) - 37.5)).toBeLessThanOrEqual(1.5);
    expect(b.level).toBe("P2");
  });

  it("算例 C 贴纸逾期 3 天：基础分 67.3，档位 P1——逾期不等于最急", () => {
    const b = scoreTask(CASE_C);
    expect(Math.abs(base(b) - 67.3)).toBeLessThanOrEqual(1.5);
    expect(b.level).toBe("P1");
  });

  it("相对排序 A > C > B（基础分口径，与采姐结论一致）", () => {
    const [a, c, bb] = [CASE_A, CASE_C, CASE_B].map((x) => base(scoreTask(x)));
    expect(a).toBeGreaterThan(c);
    expect(c).toBeGreaterThan(bb);
  });

  it("相对排序 A > C > B（最终分口径，R1 只会把 A 顶得更靠前）", () => {
    const [a, c, bb] = [CASE_A, CASE_C, CASE_B].map((x) => scoreTask(x).score);
    expect(a).toBeGreaterThan(c);
    expect(c).toBeGreaterThan(bb);
  });

  it("金额只值 8 分：B 的金额是 C 的 8 倍，f_amount 只差 0.412 → 3.3 分", () => {
    const fb = scoreTask(CASE_B).factors.find((f) => f.key === "f_amount")!;
    const fc = scoreTask(CASE_C).factors.find((f) => f.key === "f_amount")!;
    expect(fb.points - fc.points).toBeLessThan(4);
  });
});

describe("f_aging 把被冷落的任务顶上来", () => {
  it("纸盒大单晾三天：f_aging 0.6、slack 缩到 1，总分 50.5 从 P2 跨进 P1", () => {
    const day0 = scoreTask(CASE_B);
    const day3 = scoreTask({ ...CASE_B, workdaysLeft: 1, ageDays: 3 });
    expect(day0.level).toBe("P2");
    expect(Math.abs(base(day3) - 50.5)).toBeLessThanOrEqual(1.5);
    expect(day3.level).toBe("P1");
  });

  it("f_aging 躺满 5 天封顶 7 分，第 8 天不再涨", () => {
    const d5 = scoreTask({ ...CASE_B, ageDays: 5 }).factors.find((f) => f.key === "f_aging")!;
    const d8 = scoreTask({ ...CASE_B, ageDays: 8 }).factors.find((f) => f.key === "f_aging")!;
    expect(d5.points).toBeCloseTo(7, 1);
    expect(d8.points).toBeCloseTo(7, 1);
  });
});

describe("苏姐 R1 置顶", () => {
  it("日配件 + 已逾期 → 强制 +100，rules 里写清为什么", () => {
    const b = scoreTask(CASE_A);
    expect(b.score - base(b)).toBeCloseTo(RULE_R1_BONUS, 5);
    expect(b.rules.join()).toContain("R1 置顶");
  });

  it("非日配逾期（算例 C）不触发 R1——逾期本身不决定顺序，会不会断料才决定", () => {
    const b = scoreTask(CASE_C);
    expect(b.score).toBeCloseTo(base(b), 5);
    expect(b.rules.join()).not.toContain("R1");
  });

  it("已断料停线：f_stock 顶格 + 硬加 40 + R1 置顶，一定是 P0", () => {
    const b = scoreTask({ workdaysLeft: -2, demandLevel: "week", stockedOut: true, amount: 3000 });
    expect(b.factors.find((f) => f.key === "f_stock")!.value).toBe(1);
    expect(b.factors.find((f) => f.key === "bonus_stockout")!.points).toBe(BONUS_STOCKED_OUT);
    expect(b.score - base(b)).toBeCloseTo(RULE_R1_BONUS, 5);
    expect(b.level).toBe("P0");
  });

  it("没逾期的日配件不触发 R1", () => {
    const b = scoreTask({ workdaysLeft: 2, demandLevel: "daily", coverageDays: 6 });
    expect(b.score).toBeCloseTo(base(b), 5);
  });
});

describe("因子边界", () => {
  it("f_time：slack 顶到 20 天也不低于下限 0.1", () => {
    expect(scoreTask({ workdaysLeft: 20, demandLevel: "refill" }).factors[0].value).toBe(0.1);
  });

  it("f_time：slack = 0（今天就是最晚动作日）按顶格 1 算", () => {
    expect(scoreTask({ workdaysLeft: 0, demandLevel: "refill" }).factors[0].value).toBe(1);
  });

  it("coverageDays 给了就用真数，压过 demandLevel 的兜底估值", () => {
    const guess = scoreTask({ workdaysLeft: 3, demandLevel: "daily" }).factors[1].value;
    const real = scoreTask({ workdaysLeft: 3, demandLevel: "daily", coverageDays: 12 }).factors[1].value;
    expect(guess).toBe(0.95);
    expect(real).toBe(0.1);
  });

  it("覆盖天数 ≤ 0 → 断料分顶格", () => {
    expect(scoreTask({ workdaysLeft: 1, demandLevel: "daily", coverageDays: 0 }).factors[1].value).toBe(1);
  });

  it("没有准交率档案时按 0.8 兜底，why 里说清是兜底不是真数", () => {
    const f = scoreTask({ workdaysLeft: 3, demandLevel: "week" }).factors.find((x) => x.key === "f_supplier")!;
    expect(f.value).toBeCloseTo(0.6, 2);
    expect(f.why).toContain("没有准交率档案");
  });

  it("金额未知按 0 分算，不猜", () => {
    const f = scoreTask({ workdaysLeft: 3, demandLevel: "week" }).factors.find((x) => x.key === "f_amount")!;
    expect(f.points).toBe(0);
    expect(f.why).toContain("不猜");
  });

  it("分档阈值 75 / 50 / 25 的边界各落在对的档", () => {
    expect(scoreTask({ workdaysLeft: -1, demandLevel: "week", coverageDays: 0.5, onTimeRate: 0.7, ageDays: 5 }).level).toBe("P0");
    expect(scoreTask({ workdaysLeft: 0, demandLevel: "week", coverageDays: 4 }).level).toBe("P1");
    expect(scoreTask({ workdaysLeft: 4, demandLevel: "refill", coverageDays: 15, amount: 120000, onTimeRate: 0.85 }).level).toBe("P2");
    expect(scoreTask({ workdaysLeft: 15, demandLevel: "refill", coverageDays: 30, onTimeRate: 0.95 }).level).toBe("P3");
  });
});

describe("理由必须是人话（苏姐铁律①：算不出理由的分不许显示）", () => {
  it("每个因子都有非空 why，且不出现「跟进一下」这种废话", () => {
    for (const c of [CASE_A, CASE_B, CASE_C]) {
      for (const f of scoreTask(c).factors) {
        expect(f.why.trim().length).toBeGreaterThan(6);
        expect(f.why).not.toContain("跟进一下");
      }
    }
  });

  it("reasonsOf 折出的每一行都带数字，末行给出合计与档位", () => {
    const rs = reasonsOf(scoreTask(CASE_A));
    expect(rs.length).toBeGreaterThanOrEqual(6);
    expect(rs[rs.length - 1]).toContain("合计");
    expect(rs[rs.length - 1]).toContain("P0");
  });

  it("levelText 四档都给了「该做到什么程度」，不是光一个字母", () => {
    for (const l of ["P0", "P1", "P2", "P3"] as const) expect(levelText(l).length).toBeGreaterThan(6);
  });
});
