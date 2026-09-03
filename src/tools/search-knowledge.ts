// 本地知识检索：BM25 扫 已启用增强卡（内置 + 用户）+ 用户导入的文档类资料。零网络。
// 内置卡只在系统提示里给目录，正文靠这个工具按需取——38 张卡全量注入每轮要烧上万 token（2026-09-03 集成时的实测判断）。
import { Type, type Static } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { db, type EnhancementRow } from "../db/schema";
import { Bm25Index } from "../search/bm25";

function cardText(c: EnhancementRow): string {
  return [c.name, ...c.intents, ...c.triggers, ...c.sop, ...c.cautions, ...c.examples].join("\n");
}

export function renderCard(c: EnhancementRow): string {
  const parts = [`### ${c.name}`, `意图：${c.intents.join(" / ")}`];
  if (c.sop.length) parts.push("流程：\n" + c.sop.map((s, i) => `${i + 1}. ${s}`).join("\n"));
  if (c.cautions.length) parts.push("注意：\n" + c.cautions.map((s) => `- ${s}`).join("\n"));
  if (c.examples.length) parts.push("示例 / 原文：\n" + c.examples.join("\n\n"));
  return parts.join("\n");
}

const Params = Type.Object({
  query: Type.String({ description: "要查的问题或关键词，如「到货单参照订单」「逾期怎么催」「MOQ」" }),
  k: Type.Optional(Type.Number({ description: "返回条数，默认 3" })),
});

export const searchKnowledgeTool: AgentTool<typeof Params> = {
  name: "search_knowledge",
  label: "查知识库",
  description:
    "在小采的内置知识（采购技能树 / U8 单据流 / 下单·入库·跟单 SOP / 下单清单 / 带教原则）、用户教的增强卡、用户导入的文档里检索。回答任何流程、菜单路径、单据、术语、话术问题前先调它，按检索到的原文答，不要凭印象。",
  parameters: Params,
  execute: async (_id, p: Static<typeof Params>) => {
    // enabled 是布尔值，IndexedDB 不把布尔当索引键：where("enabled").equals(1) 会静默返回空数组而不是抛错，
    // 之前的 catch 兜底永远不触发，索引为空 ⇒ 每次都「知识库里没有」（2026-09-03 首次真模型联调抓到）。
    // 卡只有几十张，全量取出再在内存里筛 enabled 即可，别再走布尔索引。
    const [cards, docs] = await Promise.all([db.enhancements.toArray(), db.materials.where("role").equals("doc").toArray()]);
    const idx = new Bm25Index<{ kind: "card" | "doc"; title: string; body: string }>();
    for (const c of cards.filter((c) => c.enabled)) idx.add(`card:${c.id}`, cardText(c), { kind: "card", title: c.name, body: renderCard(c) });
    for (const d of docs) if (d.text) idx.add(`doc:${d.id}`, `${d.name}\n${d.text}`, { kind: "doc", title: d.name, body: d.text.slice(0, 2000) });
    const hits = idx.search(p.query, p.k ?? 3);
    if (!hits.length) {
      return { content: [{ type: "text", text: `知识库里没有和「${p.query}」相关的内容。如实告诉用户，并建议她问系统管理员 / 老采购，给出开口话术。` }], details: { kind: "search_knowledge", hits: [] } };
    }
    const md = hits.map((h, i) => `## 结果 ${i + 1}（${h.meta!.kind === "card" ? "知识卡" : "用户文档"}，相关度 ${h.score.toFixed(2)}）\n${h.meta!.body}`).join("\n\n---\n\n");
    return { content: [{ type: "text", text: md }], details: { kind: "search_knowledge", hits: hits.map((h) => ({ id: h.id, title: h.meta!.title, score: h.score })) } };
  },
};
