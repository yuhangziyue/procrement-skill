import { describe, expect, it } from "vitest";
import { arrivalNotice } from "./arrival-notice";

// 与 templates/tracking-sheet-template.csv 同构的虚构跟单表；日期格式故意混杂
const rows = [
  { 订单号: "PO-2026-0001", 供应商: "示例包材厂A", 物料编码: "1100002", 物料名称: "示例腰封-抹茶", 数量: "20000", 下单日: "2026-09-01", 承诺交期: "2026-09-04", 发货日: "2026-09-03", 物流单号: "EX0000000001", 到货量: "", 入库量: "", 状态: "已发货在途", 跟进记录: "9/3 电话：已发车，急料" },
  { 订单号: "PO-2026-0002", 供应商: "示例包材厂B", 物料编码: "1100003", 物料名称: "示例纸盒-6寸", 数量: "3000", 下单日: "2026-08-25", 承诺交期: "2026/9/4", 发货日: "", 物流单号: "", 到货量: "", 入库量: "", 状态: "未发货", 跟进记录: "新版首单需先检" },
  { 订单号: "PO-2026-0003", 供应商: "示例包材厂A", 物料编码: "1100001", 物料名称: "示例腰封-原味", 数量: "5000", 下单日: "2026-08-20", 承诺交期: "2026-09-04", 发货日: "2026-09-01", 物流单号: "EX0000000002", 到货量: "5000", 入库量: "5000", 状态: "已入库完结", 跟进记录: "" },
  { 订单号: "PO-2026-0004", 供应商: "示例包材厂B", 物料编码: "1100004", 物料名称: "示例纸托-方", 数量: "800", 下单日: "2026-09-01", 承诺交期: "2026-09-05", 发货日: "", 物流单号: "", 到货量: "", 入库量: "", 状态: "未发货", 跟进记录: "" },
  { 订单号: "PO-2026-0005", 供应商: "示例包材厂B", 物料编码: "1100004", 物料名称: "示例纸托-方", 数量: "800", 下单日: "2026-09-01", 承诺交期: "9月上旬", 发货日: "", 物流单号: "", 到货量: "", 入库量: "", 状态: "未发货", 跟进记录: "" },
];

describe("arrivalNotice", () => {
  it("默认筛 today+1 到货、排除已完结，日期格式混杂也能对上", () => {
    const r = arrivalNotice(rows, "2026-09-03");
    expect(r.targetDate).toBe("2026-09-04");
    expect(r.lines.map((l) => l.orderNo)).toEqual(["PO-2026-0001", "PO-2026-0002"]);
    expect(r.skipped.find((s) => s.orderNo === "PO-2026-0003")!.reason).toContain("已完结");
    expect(r.skipped.find((s) => s.orderNo === "PO-2026-0005")!.reason).toContain("解析不了");
  });

  it("急料 / 需先检 从跟进记录里识别并进备注列", () => {
    const r = arrivalNotice(rows, "2026/9/3");
    const a = r.lines.find((l) => l.orderNo === "PO-2026-0001")!;
    const b = r.lines.find((l) => l.orderNo === "PO-2026-0002")!;
    expect(a.urgent).toBe(true);
    expect(a.note).toContain("急料");
    expect(a.note).toContain("EX0000000001");
    expect(b.needInspection).toBe(true);
    expect(b.note).toContain("需先检");
    expect(r.flags.some((f) => f.includes("未发货"))).toBe(true);
  });

  it("markdown 六列表 + 话术可直接发仓库", () => {
    const r = arrivalNotice(rows, "2026-09-03");
    const head = r.markdown.split("\n")[0];
    expect(head).toBe("| 订单号 | 供应商 | 物料编码/名称 | 数量 | 预计到达时间 | 备注（急料/需先检） |");
    expect(r.markdown.split("\n")).toHaveLength(4); // 表头 2 + 2 行
    expect(r.markdown).toContain("1100002 示例腰封-抹茶");
    expect(r.message).toContain("仓库好");
    expect(r.message).toContain("2026-09-04（周五）");
    expect(r.message).toContain("PO-2026-0001");
    expect(r.headline).toContain("2 单");
  });

  it("targetDate 指定后天 → 只出 9/5 那一单", () => {
    const r = arrivalNotice(rows, "2026-09-03", { targetDate: "2026-09-05" });
    expect(r.lines.map((l) => l.orderNo)).toEqual(["PO-2026-0004"]);
    expect(r.headline).toContain("后天");
  });

  it("空表 / 明天无到货 → 不抛错，明确说不用发", () => {
    const empty = arrivalNotice([], "2026-09-03");
    expect(empty.lines).toEqual([]);
    expect(empty.headline).toContain("空");
    const none = arrivalNotice(rows, "2026-09-10");
    expect(none.lines).toEqual([]);
    expect(none.headline).toContain("不用发预告");
    expect(none.message).toContain("不用发预告");
  });

  it("today 解析不了要抛错，不静默算错日子", () => {
    expect(() => arrivalNotice(rows, "今天")).toThrow();
  });
});
