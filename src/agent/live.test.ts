// 真模型端到端（默认跳过，ARK_LIVE=1 时运行）：验证 pi-agent-core + 我们的 openai-completions 适配 + TypeBox 工具，
// 在方舟 Coding Plan 上能完成「模型调用工具 → 工具返回 → 模型总结」的完整循环。Node 里没有 CORS，测的是协议兼容性。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Agent } from "@earendil-works/pi-agent-core";
import { streamSimple } from "@earendil-works/pi-ai/api/openai-completions";
import { buildArkModel } from "../llm/model";
import { calcOrderQtyTool, backwardScheduleTool } from "../tools";

function envLocal(): Record<string, string> {
  try {
    return Object.fromEntries(
      readFileSync(".env.local", "utf8").split("\n").filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
    );
  } catch {
    return {};
  }
}
const env = envLocal();
const LIVE = process.env.ARK_LIVE === "1" && !!env.VITE_ARK_API_KEY;

describe.skipIf(!LIVE)("live · 方舟 Coding Plan × pi-agent-core", () => {
  it("模型会调用 calc_order_qty 并复述算式", async () => {
    const model = buildArkModel({ baseUrl: env.VITE_ARK_BASE_URL, modelId: env.VITE_ARK_MODEL || "doubao-seed-2.0-pro" });
    const toolCalls: string[] = [];
    const agent = new Agent({
      initialState: {
        systemPrompt: "你是采购助手。任何算量必须调用工具，不要口算。回答用中文，简短。",
        model,
        thinkingLevel: "off",
        tools: [calcOrderQtyTool, backwardScheduleTool],
      },
      streamFn: (m, ctx, opts) => streamSimple(m as any, ctx, { ...opts, apiKey: env.VITE_ARK_API_KEY }),
      toolExecution: "sequential",
    });
    agent.subscribe((ev) => {
      if (ev.type === "tool_execution_end") toolCalls.push(`${ev.toolName}:${ev.isError ? "ERR" : "ok"}`);
    });
    await agent.prompt("腰封A 生产表要 3000 只，可用库存 800，在途 500，MOQ 2000，凑整单位 500，该下多少？");
    const last = agent.state.messages.at(-1) as any;
    const text = (last.content ?? []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("");
    console.log("tool calls:", toolCalls);
    console.log("final:", text.slice(0, 400));
    expect(agent.state.errorMessage).toBeUndefined();
    expect(toolCalls.some((t) => t.startsWith("calc_order_qty:ok"))).toBe(true);
    expect(text).toMatch(/1700|2000/);
  }, 90_000);
});
