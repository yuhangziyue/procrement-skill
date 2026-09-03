import { describe, expect, it } from "vitest";
import { parseLoose, normalizeDate, trackStatus } from "./track-status";

const rows = [
  { 订单号: "PO-2026-0001", 供应商: "示例包材厂A", 物料编码: "1100002", 物料名称: "示例腰封-抹茶", 数量: "20000", 下单日: "2026-09-01", 承诺交期: "2026-09-10", 发货日: "", 物流单号: "", 到货量: "", 入库量: "", 状态: "未发货", 跟进记录: "9/3 电话：已排产" },
  { 订单号: "PO-2026-0002", 供应商: "示例包材厂B", 物料编码: "1100003", 物料名称: "示例纸盒-6寸", 数量: "3000", 下单日: "2026-08-25", 承诺交期: "2026/9/2", 发货日: "2026/8/31", 物流单号: "EX0000000003", 到货量: "3000", 入库量: "0", 状态: "已到待入库", 跟进记录: "9/2 已到货待仓库点数" },
  { 订单号: "PO-2026-0003", 供应商: "示例包材厂A", 物料编码: "1100001", 物料名称: "示例腰封-原味", 数量: "5000", 下单日: "2026-08-28", 承诺交期: "2026.9.5", 发货日: "", 物流单号: "", 到货量: "", 入库量: "", 状态: "未发货", 跟进记录: "" },
  { 订单号: "PO-2026-0004", 供应商: "示例包材厂B", 物料编码: "1100004", 物料名称: "示例纸托-方", 数量: "800", 下单日: "2026-08-20", 承诺交期: "2026年8月30日", 发货日: "2026-08-29", 物流单号: "EX0000000004", 到货量: "", 入库量: "", 状态: "已发货在途", 跟进记录: "" },
  { 订单号: "PO-2026-0005", 供应商: "示例包材厂A", 物料编码: "1100001", 物料名称: "示例腰封-原味", 数量: "5000", 下单日: "2026-08-10", 承诺交期: "2026-08-20", 发货日: "2026-08-18", 物流单号: "EX0000000005", 到货量: "5000", 入库量: "5000", 状态: "已入库完结", 跟进记录: "" },
  { 订单号: "PO-2026-0006", 供应商: "示例包材厂B", 物料编码: "1100004", 物料名称: "示例纸托-方", 数量: "800", 下单日: "2026-09-01", 承诺交期: "待定", 发货日: "", 物流单号: "", 到货量: "", 入库量: "", 状态: "未发货", 跟进记录: "" },
  { 订单号: "PO-2026-0007", 供应商: "示例包材厂A", 物料编码: "1100002", 物料名称: "示例腰封-抹茶", 数量: "2000", 下单日: "2026-09-02", 承诺交期: "2026-09-03 00:00:00", 发货日: "2026-09-02", 物流单号: "EX0000000007", 到货量: "", 入库量: "", 状态: "已发货在途", 跟进记录: "" },
];

describe("parseLoose", () => {
  it("接受多种格式，拒绝非日期与非法日", () => {
    expect(normalizeDate("2026-09-10")).toBe("2026-09-10");
    expect(normalizeDate("2026/9/10")).toBe("2026-09-10");
    expect(normalizeDate("2026.9.10")).toBe("2026-09-10");
    expect(normalizeDate("2026年9月10日")).toBe("2026-09-10");
    expect(normalizeDate("20260910")).toBe("2026-09-10");
    expect(normalizeDate("2026-09-10 08:30:00")).toBe("2026-09-10");
    expect(parseLoose("9月中旬")).toBeUndefined();
    expect(parseLoose("2026-02-30")).toBeUndefined();
    expect(parseLoose("")).toBeUndefined();
    expect(parseLoose(undefined)).toBeUndefined();
  });
});

describe("trackStatus", () => {
  it("三色判定：逾期 / 临期(≤3天，含今天) / 未到期 / 完结 / 交期缺失", () => {
    const r = trackStatus(rows, "2026-09-03");
    const by = (no: string) => r.lines.find((l) => l.orderNo === no)!;
    expect(by("PO-2026-0002").color).toBe("red");      // 9/2 < 9/3
    expect(by("PO-2026-0004").color).toBe("red");      // 8/30
    expect(by("PO-2026-0004").daysLeft).toBe(-4);
    expect(by("PO-2026-0003").color).toBe("yellow");   // 9/5，2 天
    expect(by("PO-2026-0007").color).toBe("yellow");   // 今天到期
    expect(by("PO-2026-0007").daysLeft).toBe(0);
    expect(by("PO-2026-0001").color).toBe("green");    // 9/10，7 天
    expect(by("PO-2026-0005").color).toBe("done");
    expect(by("PO-2026-0006").color).toBe("unknown");
    expect(r.counts).toEqual({ overdue: 2, dueSoon: 2, onTrack: 1, done: 1, unknown: 1, total: 7 });
  });

  it("动作文案按 05 §1：逾期问原因+新交期+通知生产；临期催发货要单号；未到期每周确认", () => {
    const r = trackStatus(rows, "2026-09-03");
    const by = (no: string) => r.lines.find((l) => l.orderNo === no)!;
    expect(by("PO-2026-0004").action).toContain("通知生产");
    expect(by("PO-2026-0002").action).toContain("入库单");           // 已到待入库的逾期 → 催仓库
    expect(by("PO-2026-0003").action).toContain("运单号");
    expect(by("PO-2026-0001").action).toContain("每周确认一次");
    expect(by("PO-2026-0006").action).toContain("YYYY-MM-DD");
    expect(by("PO-2026-0004").judgement).toContain("已逾期 4 天");
  });

  it("日期格式混杂：承诺交期归一化为 YYYY-MM-DD；today 也接受 2026/9/3", () => {
    const r = trackStatus(rows, "2026/9/3");
    expect(r.today).toBe("2026-09-03");
    const dues = Object.fromEntries(r.lines.map((l) => [l.orderNo, l.dueDate]));
    expect(dues["PO-2026-0002"]).toBe("2026-09-02");
    expect(dues["PO-2026-0003"]).toBe("2026-09-05");
    expect(dues["PO-2026-0004"]).toBe("2026-08-30");
    expect(dues["PO-2026-0007"]).toBe("2026-09-03");
    expect(dues["PO-2026-0006"]).toBe("待定"); // 解析不了原样保留
  });

  it("markdown 表逾期在前，汇总 headline 含三色计数", () => {
    const r = trackStatus(rows, "2026-09-03");
    expect(r.lines.slice(0, 2).every((l) => l.color === "red")).toBe(true);
    expect(r.lines[r.lines.length - 1].color).toBe("done");
    const md = r.markdown.split("\n");
    expect(md[0]).toContain("| 状态 | 订单号 |");
    expect(md).toHaveLength(9); // 表头 2 + 7 行
    expect(md[2]).toContain("🔴");
    expect(r.headline).toContain("🔴 逾期 2 / 🟡 临期 2 / 🟢 未到期 1");
    expect(r.flags.some((f) => f.includes("已逾期"))).toBe(true);
    expect(r.flags.some((f) => f.includes("格式对不上"))).toBe(true);
  });

  it("空表不抛错；today 非法要抛", () => {
    const r = trackStatus([], "2026-09-03");
    expect(r.lines).toEqual([]);
    expect(r.counts.total).toBe(0);
    expect(r.headline).toContain("空");
    expect(r.markdown).toContain("无数据");
    expect(() => trackStatus(rows, "今天")).toThrow();
  });
});
