import { describe, expect, it } from "vitest";
import { checkPo, type PoInput } from "./check-po";

const full: PoInput = {
  code: "1100001", name: "示例腰封-原味", spec: "新版 2026",
  qty: 5000, unit: "只",
  price: 0.12, taxRate: 0.13, taxIncluded: true,
  deliveryDate: "2026-09-10", deliveryPlace: "示例一号仓",
  receivingWindow: "工作日 8:30-16:30", packNote: "500只/扎，按扎凑整", batchPlan: "一次到货",
  qualityDocs: "送货单 + 出厂合格证随货", penalty: "按框架合同延期条款", remark: "到货须为工作日白天并提前一天预告",
};

describe("checkPo", () => {
  it("十要素齐全 → canIssue，十一行逐项全 ok", () => {
    const r = checkPo(full);
    expect(r.canIssue).toBe(true);
    expect(r.items).toHaveLength(11);
    expect(r.items.every((i) => i.ok)).toBe(true);
    expect(r.missingRequired).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.headline).toContain("回签");
  });

  it("空对象 → 五项必填全缺，canIssue=false，每项都有怎么补", () => {
    const r = checkPo({});
    expect(r.canIssue).toBe(false);
    expect(r.missingRequired).toEqual(["编码/名称规格", "数量+单位", "单价+税率+含税口径", "到货日期（精确到日）", "到货地点"]);
    for (const i of r.items.filter((x) => x.required)) expect(i.hint).toBeTruthy();
    expect(r.fixes.filter((f) => f.startsWith("【必补】"))).toHaveLength(5);
  });

  it("到货日期不精确到日（「9月中旬」）→ 拦截并指向 backward_schedule；2026/9/10 宽松格式可过", () => {
    const bad = checkPo({ ...full, deliveryDate: "9月中旬" });
    expect(bad.canIssue).toBe(false);
    const item = bad.items.find((i) => i.field === "deliveryDate")!;
    expect(item.ok).toBe(false);
    expect(item.hint).toContain("backward_schedule");

    const loose = checkPo({ ...full, deliveryDate: "2026/9/10" });
    expect(loose.canIssue).toBe(true);
    expect(loose.items.find((i) => i.field === "deliveryDate")!.value).toBe("2026-09-10");
  });

  it("含税口径没说清（taxIncluded undefined）→ 单价项不 ok", () => {
    const r = checkPo({ ...full, taxIncluded: undefined });
    expect(r.canIssue).toBe(false);
    const item = r.items.find((i) => i.field === "price")!;
    expect(item.ok).toBe(false);
    expect(item.hint).toContain("含税口径");
  });

  it("数量为 0 或只有数量没单位 → 不能发", () => {
    expect(checkPo({ ...full, qty: 0 }).canIssue).toBe(false);
    const r = checkPo({ ...full, unit: undefined });
    expect(r.canIssue).toBe(false);
    expect(r.items.find((i) => i.field === "quantity")!.hint).toContain("单位");
  });

  it("可选项缺失只警告，不拦截", () => {
    const r = checkPo({ ...full, receivingWindow: undefined, batchPlan: undefined, penalty: undefined });
    expect(r.canIssue).toBe(true);
    expect(r.warnings).toHaveLength(3);
    expect(r.headline).toContain("3 项可选项");
    expect(r.fixes.every((f) => f.startsWith("【建议】"))).toBe(true);
  });

  it("只有名称没有编码：能发但给建议补编码；税率 13 与 0.13 都认", () => {
    const r = checkPo({ ...full, code: undefined, taxRate: 13 });
    expect(r.canIssue).toBe(true);
    const item = r.items.find((i) => i.field === "item")!;
    expect(item.ok).toBe(true);
    expect(item.hint).toContain("编码");
    expect(r.items.find((i) => i.field === "price")!.value).toContain("税率 13%");
    expect(r.markdown.split("\n")).toHaveLength(13); // 表头 2 行 + 11 项
  });
});
