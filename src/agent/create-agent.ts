import { Agent, type AgentMessage, type AgentTool } from "@earendil-works/pi-agent-core";
import { arkStreamFn, buildArkModel } from "../llm/model";
import { buildSystemPrompt } from "./system-prompt";
import { getCompanyConfig, getLlmSettings } from "../db/settings";
import { db } from "../db/schema";
import { buildTools } from "../tools";

/** 剔除不能回放给模型的脏消息；纯函数，供 transformContext 与持久化共用 */
export function sanitizeHistory(messages: AgentMessage[]): AgentMessage[] {
  const out: AgentMessage[] = [];
  const liveToolCallIds = new Set<string>();
  for (const m of messages as any[]) {
    if (m.role === "assistant") {
      const content = Array.isArray(m.content) ? m.content : [];
      const meaningful = content.filter((c: any) => (c.type === "text" && c.text?.trim()) || c.type === "toolCall");
      if ((m.stopReason === "error" || m.stopReason === "aborted") && meaningful.length === 0) continue;
      if (meaningful.length === 0) continue;
      for (const c of content) if (c.type === "toolCall") liveToolCallIds.add(c.id);
      out.push(m);
      continue;
    }
    if (m.role === "toolResult") {
      if (!liveToolCallIds.has(m.toolCallId)) continue; // 孤儿工具结果
      out.push(m);
      continue;
    }
    out.push(m);
  }
  return out;
}

export interface CreateAgentOptions {
  sessionId: string;
  messages?: AgentMessage[];
  tools?: AgentTool<any>[];
}

/** 每个会话一个 Agent 实例；设置或增强卡变化时重建即可（state.messages 可原样带过去）。 */
export async function createAgent(opts: CreateAgentOptions): Promise<Agent> {
  const [llm, company, cards] = await Promise.all([
    getLlmSettings(),
    getCompanyConfig(),
    db.enhancements.toArray(),
  ]);
  return new Agent({
    // 报错 / 中断留下的空 assistant 消息（stopReason error|aborted、content 为空）不能回放给模型：
    // 方舟对空 assistant content 直接回 400，一条脏消息会让这个会话之后每一句都失败（2026-09-03 线上实测）。
    // 同时把紧跟其后、已无对应 toolCall 的 toolResult 一起剔掉。
    transformContext: async (messages) => sanitizeHistory(messages),
    initialState: {
      systemPrompt: buildSystemPrompt(company, cards),
      model: buildArkModel(llm),
      thinkingLevel: "off",
      tools: opts.tools ?? buildTools({ sessionId: opts.sessionId }),
      messages: opts.messages ?? [],
    },
    streamFn: arkStreamFn,
    sessionId: opts.sessionId,
    toolExecution: "sequential",
  });
}
