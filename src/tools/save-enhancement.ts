// 「教它」工具：模型抽出增强卡草稿 → 交给 UI 预览（EnhancementPreview）→ 用户确认后才由 UI 调 saveEnhancement 落库。
// 工具本身不写库：确认权在人（评审决议：不自动覆盖、不自动落库）。
import { Type, type Static } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { EnhancementDraft } from "../db/enhancements";

const Params = Type.Object({
  name: Type.String({ description: "卡名，≤20 字，如「日配件断料先查 B 仓」" }),
  intents: Type.Array(Type.String(), { description: "这张卡回答什么问题 / 什么情境下用，1~3 条" }),
  triggers: Type.Array(Type.String(), { description: "触发关键词 3~8 个" }),
  sop: Type.Array(Type.String(), { description: "操作步骤，一条一步" }),
  cautions: Type.Array(Type.String(), { description: "注意事项 / 禁区" }),
  examples: Type.Optional(Type.Array(Type.String(), { description: "例句或例子" })),
});

export type DraftListener = (draft: EnhancementDraft & { sourceSessionId: string }) => void;
const listeners = new Set<DraftListener>();
/** UI 订阅草稿：收到即弹预览 */
export function onEnhancementDraft(fn: DraftListener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function makeSaveEnhancementTool(sessionId: string): AgentTool<typeof Params> {
  return {
    name: "save_enhancement",
    label: "教它（存增强卡）",
    description:
      "当用户说「记住 / 以后遇到…就… / 我们公司的做法是…」，或对回答点了 👎 并要教正确做法时，把规矩整理成增强卡草稿交给用户确认。不要替用户决定是否保存；调用后告诉用户「卡片草稿已弹出，确认后下次就按它办」。",
    parameters: Params,
    execute: async (_id, p: Static<typeof Params>) => {
      const draft: EnhancementDraft & { sourceSessionId: string } = {
        name: p.name,
        intents: p.intents,
        triggers: p.triggers,
        sop: p.sop,
        cautions: p.cautions,
        examples: p.examples ?? [],
        enabled: true,
        origin: "taught",
        sourceSessionId: sessionId,
      };
      listeners.forEach((fn) => fn(draft));
      return {
        content: [{ type: "text", text: `已生成增强卡草稿「${p.name}」（触发词：${p.triggers.join("、")}），等待用户在预览里确认。` }],
        details: { kind: "save_enhancement", draft },
      };
    },
  };
}
