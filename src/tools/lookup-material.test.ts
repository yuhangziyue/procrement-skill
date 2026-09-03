import { describe, expect, it } from "vitest";
import { lookupMaterial } from "./lookup-material";

// 与 templates/material-list-template.csv 同构的虚构物料表
const rows = [
  { 存货编码: "1100001", 存货名称: "示例腰封-原味", 供应商: "示例包材厂A", 采购状态: "在购", 原始备注: "" },
  { 存货编码: "1100002", 存货名称: "示例腰封-抹茶", 供应商: "示例包材厂A", 采购状态: "在购-日配", 原始备注: "每天约2000只" },
  { 存货编码: "1100003", 存货名称: "示例纸盒-6寸", 供应商: "示例包材厂B", 采购状态: "在购-警示将下架", 原始备注: "下季度改版" },
  { 存货编码: "1100004", 存货名称: "示例纸托-方", 供应商: "示例包材厂B", 采购状态: "按需-有需求才买", 原始备注: "" },
  { 存货编码: "1100005", 存货名称: "示例贴纸-旧版", 供应商: "示例包材厂A", 采购状态: "停购-长期不买", 原始备注: "2025年起停用" },
  { 存货编码: "1100006", 存货名称: "示例插格-旧款", 供应商: "示例包材厂B", 采购状态: "停购-已下架", 原始备注: "" },
  { 存货编码: "1100007", 存货名称: "示例封口贴", 供应商: "示例包材厂B", 采购状态: "", 原始备注: "" },
];

describe("lookupMaterial", () => {
  it("编码精确匹配优先，在购 → ok", () => {
    const r = lookupMaterial(rows, { code: " 1100001 ", name: "腰封" });
    expect(r.matchedBy).toBe("code");
    expect(r.hits).toHaveLength(1);
    expect(r.verdict).toBe("ok");
    expect(r.hits[0].priority).toBeUndefined();
    expect(r.headline).toContain("可以下单");
  });

  it("在购-日配 → ok 且标 priority daily", () => {
    const r = lookupMaterial(rows, { code: "1100002" });
    expect(r.hits[0].verdict).toBe("ok");
    expect(r.hits[0].priority).toBe("daily");
    expect(r.hits[0].conclusion).toContain("日配");
  });

  it("停购命中 → blocked，结论要反问生产是否复用旧包材", () => {
    const a = lookupMaterial(rows, { code: "1100005" });
    const b = lookupMaterial(rows, { code: "1100006" });
    expect(a.verdict).toBe("blocked");
    expect(b.verdict).toBe("blocked");
    expect(a.hits[0].conclusion).toContain("不下单");
    expect(a.hits[0].conclusion).toContain("复用旧包材");
  });

  it("警示将下架 → confirm_alive；按需 → need_source；状态空白 → ask_production", () => {
    expect(lookupMaterial(rows, { code: "1100003" }).verdict).toBe("confirm_alive");
    expect(lookupMaterial(rows, { code: "1100004" }).verdict).toBe("need_source");
    expect(lookupMaterial(rows, { code: "1100007" }).verdict).toBe("ask_production");
  });

  it("编码没有时退到名称包含匹配，多命中全部返回并提示核对编码", () => {
    const r = lookupMaterial(rows, { code: "9999999", name: "示例腰封" });
    expect(r.matchedBy).toBe("name");
    expect(r.hits.map((h) => h.code)).toEqual(["1100001", "1100002"]);
    expect(r.verdict).toBe("multiple");
    expect(r.flags.some((f) => f.includes("编码对不上"))).toBe(true);
  });

  it("名称匹配忽略大小写和空格", () => {
    const r = lookupMaterial(rows, { name: "纸 盒" });
    expect(r.hits).toHaveLength(1);
    expect(r.hits[0].code).toBe("1100003");
  });

  it("未命中 → not_found，提示先和生产核对不猜", () => {
    const r = lookupMaterial(rows, { code: "0000000", name: "不存在的料" });
    expect(r.verdict).toBe("not_found");
    expect(r.hits).toHaveLength(0);
    expect(r.headline).toContain("和生产核对");
    expect(r.headline).toContain("不猜");
  });

  it("空表 / 空查询 都返回 not_found 不抛错", () => {
    expect(lookupMaterial([], { code: "1100001" }).verdict).toBe("not_found");
    expect(lookupMaterial(rows, {}).verdict).toBe("not_found");
  });

  it("兼容「物料编码/物料名称」列名", () => {
    const alt = [{ 物料编码: "2200001", 物料名称: "示例纸袋", 供应商: "示例包材厂A", 采购状态: "在购" }];
    const r = lookupMaterial(alt, { code: "2200001" });
    expect(r.verdict).toBe("ok");
    expect(r.hits[0].name).toBe("示例纸袋");
  });
});
