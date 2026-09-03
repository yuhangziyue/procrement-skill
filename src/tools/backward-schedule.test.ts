import { describe, expect, it } from "vitest";
import { backwardSchedule } from "./backward-schedule";

describe("backwardSchedule", () => {
  it("order-checklist §B 示例：需求 9/15，运输 2，生产 7 周日不产，今天 9/2 17:00 过截止 ⇒ 来不及", () => {
    const r = backwardSchedule({
      needDate: "2026-09-15", today: "2026-09-02", nowTime: "17:00", orderCutoff: "16:00",
      arrivalBufferDays: 1, transportDays: 2, productionDays: 7, productionCalendar: "skip_sunday",
    });
    // 9/15 周二 → 目标 9/14 周一（工作日可收）→ 发货 9/12 周六 → 往前 7 个非周日：9/11,10,9,8,7,5(跳 9/6 周日),4 → 接单 9/4 → 缓冲 1 → 最晚下单 9/3
    expect(r.targetArrivalDate).toBe("2026-09-14");
    expect(r.shipDate).toBe("2026-09-12");
    expect(r.productionStartDate).toBe("2026-09-04");
    expect(r.latestOrderDate).toBe("2026-09-03");
    expect(r.ok).toBe(true); // 9/3 > 9/2，还来得及；截止修正只在“今天就是最晚日”时触发
  });

  it("今天就是最晚下单日且已过截止 ⇒ 来不及并给两条路", () => {
    const r = backwardSchedule({
      needDate: "2026-09-15", today: "2026-09-03", nowTime: "17:00", orderCutoff: "16:00",
      transportDays: 2, productionDays: 7, productionCalendar: "skip_sunday", expediteProductionDays: 3,
    });
    expect(r.latestOrderDate).toBe("2026-09-03");
    expect(r.ok).toBe(false);
    expect(r.alternatives?.expedite?.latestOrderDate).toBe("2026-09-08");
    expect(r.alternatives?.earliestArrival.date).toBeDefined();
  });

  it("目标到货落周末 ⇒ 提前到周五；固定发车日对齐", () => {
    // 需求 9/13 周日，缓冲 1 → 9/12 周六 → 提前到 9/11 周五
    const r = backwardSchedule({ needDate: "2026-09-13", today: "2026-08-20", transportDays: 1, productionDays: 3, shipWeekdays: [2, 4, 6] });
    expect(r.targetArrivalDate).toBe("2026-09-11");
    // 发货 9/10 周四，在发车日集合里，不再前移
    expect(r.shipDate).toBe("2026-09-10");
    expect(r.flags.some((f) => f.includes("提前"))).toBe(true);
  });

  it("准交差 + 旺季 ⇒ 缓冲 3；横跨国庆给提示", () => {
    const r = backwardSchedule({ needDate: "2026-10-12", today: "2026-09-10", transportDays: 2, productionDays: 5, onTimeGrade: "poor", season: "peak" });
    expect(r.bufferDays).toBe(3);
    expect(r.flags.some((f) => f.includes("国庆"))).toBe(true);
  });

  it("只算工作日口径会跳过法定节假日", () => {
    // 需求 10/13 周二 → 目标 10/12 周一 → 运输 1 → 发货 10/11 周日 … 生产 3 个工作日往前：10/10(调休上班) 10/9 10/8 → 开工 10/8
    const r = backwardSchedule({ needDate: "2026-10-13", today: "2026-09-01", transportDays: 1, productionDays: 3, productionCalendar: "workdays" });
    expect(r.productionStartDate).toBe("2026-10-08");
  });
});
