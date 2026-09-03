import { describe, expect, it } from "vitest";
import { calcOrderQty } from "./calc-order-qty";

describe("calcOrderQty", () => {
  it("基本净缺口 + MOQ 三选一 + 凑整", () => {
    const r = calcOrderQty({ item: "腰封A", demand: 3000, available: 800, inTransit: [{ qty: 500 }], moq: 2000, packUnit: 500 });
    expect(r.rawGap).toBe(1700);
    expect(r.verdict).toBe("confirm_first");
    expect(r.moqOptions?.length).toBe(3);
    expect(r.roundedQty).toBe(2000);
  });

  it("逾期在途不算有效在途", () => {
    const r = calcOrderQty({ item: "x", demand: 1000, available: 0, today: "2026-09-03", inTransit: [{ qty: 600, plannedDate: "2026-08-30" }, { qty: 200, plannedDate: "2026-09-05" }] });
    expect(r.validTransit).toBe(200);
    expect(r.overdueTransit).toBe(600);
    expect(r.rawGap).toBe(800);
  });

  it("库存够 ⇒ 不下", () => {
    expect(calcOrderQty({ item: "x", demand: 100, available: 150 }).verdict).toBe("no_order");
  });

  it("停购状态直接拦截", () => {
    expect(calcOrderQty({ item: "旧贴纸", status: "停购-长期不买", demand: 100, available: 0 }).verdict).toBe("blocked");
  });

  it("多仓调拨优先；缺他仓需求不算；来不及不调", () => {
    const r = calcOrderQty({
      item: "x", demand: 5000, available: 1000, daysUntilNeed: 3,
      otherWarehouses: [
        { name: "B仓", onHand: 6000, inTransit: 0, ownDemand: 3000, safety: 500, transferDays: 1 },
        { name: "C仓", onHand: 9000 },
        { name: "D仓", onHand: 9000, ownDemand: 0, transferDays: 5 },
      ],
      packUnit: 100,
    });
    expect(r.transfers).toEqual([{ from: "B仓", qty: 2500 }]);
    expect(r.purchaseGap).toBe(1500);
    expect(r.flags.some((f) => f.includes("C仓"))).toBe(true);
    expect(r.flags.some((f) => f.includes("D仓") && f.includes("来不及"))).toBe(true);
    expect(r.verdict).toBe("order");
  });

  it("超单次接单量 / 分批阈值给提示", () => {
    const r = calcOrderQty({ item: "x", demand: 200000, available: 0, maxPerOrder: 50000, batchThreshold: 100000 });
    expect(r.flags.some((f) => f.includes("单次最大接单量"))).toBe(true);
    expect(r.flags.some((f) => f.includes("分批"))).toBe(true);
  });

  it("「在购-警示将下架」不能被当成停购拦掉——它含「下架」二字，但还能下单", () => {
    const r = calcOrderQty({ item: "单片贴纸", status: "在购-警示将下架", demand: 3000, available: 500, inTransit: [] });
    expect(r.verdict).not.toBe("blocked");
    expect(r.flags.some((f) => f.includes("量放保守"))).toBe(true);
  });

  it("真停购仍然拦住", () => {
    expect(calcOrderQty({ item: "瓦楞隔板", status: "停购-已下架", demand: 3000, available: 0, inTransit: [] }).verdict).toBe("blocked");
  });
});
