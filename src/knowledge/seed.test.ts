import { describe, expect, it } from "vitest";
import { buildBuiltinCards, isCautionLine, splitMarkdownToCards } from "./seed";

describe("splitMarkdownToCards", () => {
  const md = `# 09 · 测试篇（示例）

> 前言：目标是验证切分。

## 1. 第一节

### 第一步：动手

1. 查库存
2. 算缺口，**不要**跳步
- [ ] 已回签

| 列A | 列B |
|---|---|
| 1 | 2 |

普通段落说明。

## 2. 第二节 ⚠️

必须先确认版本。
`;

  it("每个 ## 一张卡；id / name / intents 稳定", () => {
    const cards = splitMarkdownToCards("09-test.md", md);
    expect(cards.map((c) => c.id)).toEqual(["builtin:09-test:1", "builtin:09-test:2"]);
    expect(cards[0].name).toBe("09 · 测试篇 · 1. 第一节");
    expect(cards[0].intents).toEqual(["1. 第一节", "09 · 测试篇（示例）"]);
    expect(cards[0].origin).toBe("builtin");
    expect(cards[0].enabled).toBe(true);
    expect(cards[0].createdAt).toBe(0);
    expect(cards[0].conflictsWith).toEqual([]);
  });

  it("列表进 sop（含 ### 小标题行），警示词进 cautions，表格/段落进 examples", () => {
    const [c1, c2] = splitMarkdownToCards("09-test.md", md);
    expect(c1.sop).toEqual(["▶ 第一步：动手", "查库存", "算缺口，**不要**跳步", "已回签"]);
    expect(c1.cautions).toEqual(["算缺口，**不要**跳步"]);
    expect(c1.examples.some((e) => e.startsWith("| 列A"))).toBe(true);
    expect(c1.examples).toContain("普通段落说明。");
    expect(c1.examples).toContain("前言：目标是验证切分。");
    expect(c2.sop).toEqual([]);
    expect(c2.cautions).toEqual(["必须先确认版本。"]);
  });

  it("examples 超 600 字截断并加标记", () => {
    const long = `# 长\n\n## 节\n\n${"一".repeat(700)}\n`;
    const [c] = splitMarkdownToCards("long.md", long);
    expect(c.examples.length).toBe(1);
    expect(c.examples[0].endsWith("…（详见原文）")).toBe(true);
    expect(Array.from(c.examples[0]).length).toBeLessThanOrEqual(600 + "…（详见原文）".length);
  });

  it("「别」只在提醒语境算警示", () => {
    expect(isCautionLine("别下一张注定迟到的单")).toBe(true);
    expect(isCautionLine("延误影响别人排产")).toBe(false);
    expect(isCautionLine("区别在于确认环节")).toBe(false);
    expect(isCautionLine("🔴 新手最常见事故")).toBe(true);
  });
});

describe("buildBuiltinCards", () => {
  const cards = buildBuiltinCards();

  it("六篇都切出了卡，id 唯一且全是 builtin", () => {
    const files = new Set(cards.map((c) => c.id.split(":")[1]));
    expect(files).toEqual(
      new Set(["01-skill-tree", "02-u8-basics", "03-sop-place-order", "04-sop-goods-receipt", "05-sop-tracking", "06-coaching-general", "order-checklist"]),
    );
    expect(new Set(cards.map((c) => c.id)).size).toBe(cards.length);
    expect(cards.every((c) => c.origin === "builtin" && c.enabled && c.createdAt === 0)).toBe(true);
  });

  it("每张卡 3~8 个触发词，且卡有实质内容", () => {
    for (const c of cards) {
      expect(c.triggers.length, c.id).toBeGreaterThanOrEqual(3);
      expect(c.triggers.length, c.id).toBeLessThanOrEqual(8);
      expect(c.sop.length + c.cautions.length + c.examples.length, c.id).toBeGreaterThan(0);
      for (const e of c.examples) expect(Array.from(e).length, c.id).toBeLessThanOrEqual(600 + 8);
    }
  });

  it("下单场景1 卡：触发词含 下单/缺料，🔴 事故进 cautions", () => {
    const c = cards.find((x) => x.id === "builtin:03-sop-place-order:1")!;
    expect(c.name).toContain("场景1");
    expect(c.triggers).toEqual(expect.arrayContaining(["下单", "缺料"]));
    expect(c.cautions.some((s) => s.includes("🔴") && s.includes("重复采购"))).toBe(true);
    expect(c.sop.some((s) => s.startsWith("▶ 第一步"))).toBe(true);
  });

  it("两次构建结果完全一致（幂等）", () => {
    expect(buildBuiltinCards()).toEqual(cards);
  });
});
