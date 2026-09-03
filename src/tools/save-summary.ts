// 会话小结工具：按事件而不是按轮数（采姐评审）。模型在「一张 PO 走完 / 用户要求 / 关会话前」调用，写入 summaries 表。
import { Type, type Static } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { db } from "../db/schema";
import { newId } from "../util/id";

const Params = Type.Object({
  kind: Type.Union([Type.Literal("po_done"), Type.Literal("manual"), Type.Literal("close")], {
    description: "po_done=一张采购单从算量到发出走完了；manual=用户要求小结；close=会话收尾",
  }),
  text: Type.String({ description: "≤200 字的小结正文：做了什么、结论是什么" }),
  keyFacts: Type.Array(Type.String(), { description: "本次确定的事实（数量 / 日期 / 供应商承诺），每条一句" }),
  openItems: Type.Array(Type.String(), { description: "待办 / 待确认（找谁、期限）" }),
  learnedRules: Type.Optional(Type.Array(Type.String(), { description: "对话里新出现的公司规矩，值得存成增强卡的" })),
});

export function makeSaveSummaryTool(sessionId: string): AgentTool<typeof Params> {
  return {
    name: "save_summary",
    label: "会话小结",
    description:
      "把本次会话做成留痕小结（事实 / 待办 / 新学到的规矩）并保存。触发时机：一张采购单从算量到发出全部走完；用户说「小结 / 总结一下」；会话要收尾。不要每几轮就调。",
    parameters: Params,
    execute: async (_id, p: Static<typeof Params>) => {
      const now = Date.now();
      const existing = await db.summaries.where("sessionId").equals(sessionId).first();
      const id = existing?.id ?? newId();
      await db.summaries.put({ id, sessionId, kind: p.kind, text: p.text, keyFacts: p.keyFacts, openItems: p.openItems, updatedAt: now });
      await db.sessions.update(sessionId, { summaryId: id, updatedAt: now });
      const md = [
        `**小结已保存**（${{ po_done: "一张 PO 走完", manual: "手动", close: "收尾" }[p.kind]}）`,
        "",
        p.text,
        p.keyFacts.length ? `\n**事实**\n${p.keyFacts.map((s) => `- ${s}`).join("\n")}` : "",
        p.openItems.length ? `\n**待办**\n${p.openItems.map((s) => `- [ ] ${s}`).join("\n")}` : "",
        p.learnedRules?.length ? `\n**新规矩（可以点「教它」存成增强卡）**\n${p.learnedRules.map((s) => `- ${s}`).join("\n")}` : "",
      ]
        .join("\n")
        .trim();
      return { content: [{ type: "text", text: md }], details: { kind: "save_summary", summaryId: id, learnedRules: p.learnedRules ?? [] } };
    },
  };
}
