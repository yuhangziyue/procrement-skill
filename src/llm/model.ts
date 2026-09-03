// pi-ai 适配：只引 openai-completions 一条路径，避免把 anthropic/google/bedrock SDK 打进浏览器包。
import type { Model } from "@earendil-works/pi-ai";
import { streamSimple } from "@earendil-works/pi-ai/api/openai-completions";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import { getApiKey, type LlmSettings } from "../db/settings";

export const ARK_PROVIDER = "volcengine-ark";

export function buildArkModel(s: LlmSettings): Model<"openai-completions"> {
  const baseUrl = (s.proxyUrl?.trim() || s.baseUrl).replace(/\/+$/, "");
  return {
    id: s.modelId,
    name: `${s.modelId} (火山方舟)`,
    api: "openai-completions",
    provider: ARK_PROVIDER,
    baseUrl,
    reasoning: false,
    input: ["text"],
    // Coding Plan 订阅内边际成本≈0；按量端点的单价随模型变，这里不假装知道
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 8_192,
    // 方舟不在 pi 的 URL 自动识别表里，显式声明兼容项，别让 pi 按 OpenAI 官方口径发 store/developer 字段
    compat: {
      supportsStore: false,
      supportsDeveloperRole: false,
      supportsReasoningEffort: false,
      supportsUsageInStreaming: true,
      maxTokensField: "max_tokens",
      requiresToolResultName: false,
      requiresAssistantAfterToolResult: false,
      supportsStrictMode: false,
    },
  };
}

/** Agent 用的流式函数：每次调用时从 localStorage 取 Key，改了设置立即生效。 */
export const arkStreamFn: StreamFn = (model, context, options) =>
  streamSimple(model as Model<"openai-completions">, context, {
    ...options,
    apiKey: getApiKey() || options?.apiKey,
  });
