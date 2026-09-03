import { describe, expect, it } from "vitest";
import { DEFAULT_LIMITS, chunk, splitSections, splitSentences } from "./chunk";

const zh = (n: number, ch = "采") => ch.repeat(n);

describe("splitSections", () => {
  it("按标题分节，heading 是标题链", () => {
    const secs = splitSections("# 采购制度\n开篇\n## 请购流程\n正文一\n### 例外\n正文二\n## 付款\n正文三");
    expect(secs.map((s) => s.heading)).toEqual(["采购制度", "采购制度 > 请购流程", "采购制度 > 请购流程 > 例外", "采购制度 > 付款"]);
    expect(secs[2].body).toBe("正文二");
  });

  it("代码围栏里的 # 不当标题", () => {
    const secs = splitSections("# 标题\n```\n# 这是注释\n```\n正文");
    expect(secs).toHaveLength(1);
    expect(secs[0].body).toContain("# 这是注释");
  });

  it("无标题文档 → 单节，heading 为空", () => {
    const secs = splitSections("第一段\n\n第二段");
    expect(secs).toEqual([{ heading: "", body: "第一段\n\n第二段" }]);
  });
});

describe("splitSentences", () => {
  it("按中文句末标点切", () => {
    expect(splitSentences("下单要看缺料。MOQ 要凑整；交期要倒推！")).toEqual(["下单要看缺料。", "MOQ 要凑整；", "交期要倒推！"]);
  });

  it("超长且无句末标点 → 退到逗号切", () => {
    const parts = splitSentences(`${zh(700)}，${zh(700)}`, 1200);
    expect(parts).toHaveLength(2);
    expect(parts[0].endsWith("，")).toBe(true);
  });

  it("完全无标点的超长串硬切到上限以内", () => {
    const parts = splitSentences(zh(2500), 1000);
    expect(parts).toHaveLength(3);
    expect(Math.max(...parts.map((p) => p.length))).toBeLessThanOrEqual(1000);
  });
});

describe("chunk", () => {
  it("空输入 / 纯空白 → 空数组", () => {
    expect(chunk("")).toEqual([]);
    expect(chunk("   \n\n \t ")).toEqual([]);
  });

  it("只有一行 → 一块，seq 从 0 开始", () => {
    const cs = chunk("采购员每天先看跟单表。");
    expect(cs).toHaveLength(1);
    expect(cs[0]).toMatchObject({ seq: 0, heading: "", text: "采购员每天先看跟单表。" });
  });

  it("每块都保留所属标题链", () => {
    const md = `# 采购制度\n## 请购流程\n${zh(600, "请")}\n\n## 付款流程\n${zh(600, "付")}`;
    const cs = chunk(md);
    expect(cs.map((c) => c.heading)).toEqual(["采购制度 > 请购流程", "采购制度 > 付款流程"]);
  });

  it("任何块都不超过硬上限 1200", () => {
    const md = `# A\n${zh(5000)}\n\n## B\n${Array.from({ length: 40 }, (_, i) => `第${i}段` + zh(120)).join("\n\n")}`;
    const cs = chunk(md);
    expect(cs.length).toBeGreaterThan(4);
    expect(Math.max(...cs.map((c) => c.text.length))).toBeLessThanOrEqual(DEFAULT_LIMITS.max);
  });

  it("短段落聚合到目标长度，不会一段一块", () => {
    const text = Array.from({ length: 12 }, (_, i) => `第${i}段：` + zh(100)).join("\n\n");
    const cs = chunk(text);
    // 12 段 × ~105 字 ≈ 1260 字，按 400–800 打包应在 2–3 块
    expect(cs.length).toBeLessThanOrEqual(3);
    expect(cs.every((c) => c.text.length >= DEFAULT_LIMITS.min)).toBe(true);
  });

  it("碎块向后合并，heading 退到公共祖先并标出子标题", () => {
    const cs = chunk("# 手册\n## 甲\n很短。\n## 乙\n也很短。");
    expect(cs).toHaveLength(1);
    expect(cs[0].heading).toBe("手册");
    expect(cs[0].text).toContain("【乙】");
  });

  it("超长无标点段落被硬切且不丢字", () => {
    const cs = chunk(zh(3000));
    expect(cs.length).toBeGreaterThan(1);
    expect(cs.map((c) => c.text).join("")).toBe(zh(3000));
  });

  it("纯英文文档也能切，seq 连续", () => {
    const para = "The buyer confirms the purchase order. ".repeat(60);
    const cs = chunk(`# Purchasing\n${para}`);
    expect(cs.length).toBeGreaterThan(1);
    expect(cs.map((c) => c.seq)).toEqual(cs.map((_, i) => i));
    expect(cs.every((c) => c.heading === "Purchasing")).toBe(true);
  });

  it("表格类多行段落按行拆，不把一行腰斩", () => {
    const rows = Array.from({ length: 30 }, (_, i) => `| 物料${i} | 数量${i} | ${zh(60)} |`).join("\n");
    const cs = chunk(rows);
    expect(cs.length).toBeGreaterThan(1);
    for (const c of cs) for (const line of c.text.split("\n")) expect(line.startsWith("| 物料")).toBe(true);
  });
});
