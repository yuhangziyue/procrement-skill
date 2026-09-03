import { Agent, type AgentMessage, type AgentTool } from "@earendil-works/pi-agent-core";
import { arkStreamFn, buildArkModel } from "../llm/model";
import { buildSystemPrompt } from "./system-prompt";
import { getCompanyConfig, getLlmSettings } from "../db/settings";
import { db } from "../db/schema";
import { buildTools } from "../tools";

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
