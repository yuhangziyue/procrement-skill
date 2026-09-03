import { describe, expect, it } from "vitest";
import { detectRole, diffRows, parseCsv, rowsFromMatrix, summarizeDiff, type Row } from "./materials";

describe("parseCsv", () => {
  it("去 BOM、列名 trim、跳过空行", () => {
    const text = "﻿存货编码 , 存货名称,采购状态\n1100001,示例腰封-原味,在购\n\n1100002, 示例腰封-抹茶 ,在购-日配\n";
    const rows = parseCsv(text);
    expect(rows).toHaveLength(2);
    expect(Object.keys(rows[0])).toEqual(["存货编码", "存货名称", "采购状态"]);
    expect(rows[1]["存货名称"]).toBe("示例腰封-抹茶");
  });

  it("尾部多余逗号不产生空列", () => {
    const rows = parseCsv("订单号,状态\nPO-1,未发货,\n");
    expect(Object.keys(rows[0])).toEqual(["订单号", "状态"]);
  });
});

describe("rowsFromMatrix", () => {
  it("供应商档案：跳过说明行，找含「字段」的那行当表头", () => {
    const m = [
      ["供应商供货习惯档案（说明）"],
      ["填写前请先看 README"],
      [],
      ["分组", "字段", "示例（虚构值）", "供应商A"],
      ["一、联系与商务", "付款条款", "月结60", "月结30"],
      ["二、订购规则", "凑整单位", "500只/扎", ""],
    ];
    const rows = rowsFromMatrix(m);
    expect(rows).toHaveLength(2);
    expect(rows[0]["字段"]).toBe("付款条款");
    expect(rows[1]["供应商A"]).toBe("");
  });

  it("普通表：首个非空行当表头", () => {
    const rows = rowsFromMatrix([[], ["存货编码", "存货名称"], ["1100001", "示例纸盒"]]);
    expect(rows).toEqual([{ 存货编码: "1100001", 存货名称: "示例纸盒" }]);
  });
});

describe("detectRole", () => {
  it("按列名识别三种模板", () => {
    expect(detectRole(["存货编码", "存货名称", "供应商", "采购状态", "原始备注"])).toBe("materials");
    expect(detectRole(["订单号", "供应商", "物料编码", "承诺交期", "状态"])).toBe("tracking");
    expect(detectRole(["分组", "字段", "为什么要这个", "示例（格式参考·虚构值）", "供应商A"])).toBe("suppliers");
  });
  it("识别不出返回 undefined", () => {
    expect(detectRole(["a", "b"])).toBeUndefined();
    expect(detectRole(["订单号"])).toBeUndefined();
  });
});

describe("diffRows", () => {
  const prev: Row[] = [
    { 存货编码: "1100001", 存货名称: "示例腰封-原味", 采购状态: "在购" },
    { 存货编码: "1100002", 存货名称: "示例腰封-抹茶", 采购状态: "在购-日配" },
    { 存货编码: "1100005", 存货名称: "示例贴纸-旧版", 采购状态: "在购" },
  ];
  const next: Row[] = [
    { 存货编码: "1100001", 存货名称: "示例腰封-原味", 采购状态: "在购" },
    { 存货编码: "1100005", 存货名称: "示例贴纸-旧版", 采购状态: "停购-长期不买", 原始备注: "2025起停用" },
    { 存货编码: "1100006", 存货名称: "示例插格-新款", 采购状态: "在购" },
  ];

  it("单键：新增 / 删除 / 字段变化", () => {
    const d = diffRows(prev, next, "存货编码");
    expect(d.added.map((r) => r["存货编码"])).toEqual(["1100006"]);
    expect(d.removed.map((r) => r["存货编码"])).toEqual(["1100002"]);
    expect(d.changed).toEqual([
      { key: "1100005", field: "采购状态", from: "在购", to: "停购-长期不买" },
      { key: "1100005", field: "原始备注", from: "", to: "2025起停用" },
    ]);
  });

  it("摘要：状态变化只数状态列", () => {
    const s = summarizeDiff(diffRows(prev, next, "存货编码"), "materials");
    expect(s).toEqual({ added: 1, removed: 1, statusChanged: 1, rowsChanged: 1 });
  });

  it("复合键：订单号+物料编码", () => {
    const a: Row[] = [
      { 订单号: "PO-1", 物料编码: "1100002", 状态: "未发货" },
      { 订单号: "PO-1", 物料编码: "1100003", 状态: "未发货" },
    ];
    const b: Row[] = [
      { 订单号: "PO-1", 物料编码: "1100002", 状态: "已发货" },
      { 订单号: "PO-1", 物料编码: "1100003", 状态: "未发货" },
      { 订单号: "PO-2", 物料编码: "1100002", 状态: "未发货" },
    ];
    const d = diffRows(a, b, ["订单号", "物料编码"]);
    expect(d.added).toHaveLength(1);
    expect(d.removed).toHaveLength(0);
    expect(d.changed).toEqual([{ key: "PO-1|1100002", field: "状态", from: "未发货", to: "已发货" }]);
    expect(summarizeDiff(d, "tracking").statusChanged).toBe(1);
  });
});
