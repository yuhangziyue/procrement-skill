// pi-ai 适配：只引 openai-completions 一条路径，避免把 anthropic/google/bedrock SDK 打进浏览器包。
import type { Model } from "@earendil-works/pi-ai";
import { streamSimple } from "@earendil-works/pi-ai/api/openai-completions";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import { getApiKey, type LlmSettings } from "../db/settings";

export const ARK_PROVIDER = "volcengine-ark";

const ARK_ORIGIN = "https://ark.cn-beijing.volces.com/api";

/**
 * 本地开发：Coding Plan 端点的 CORS 预检不放行 Authorization（2026-09-03 实测），浏览器直连必挂。
 * vite.config.ts 里配了 /ark → 方舟 的 dev 代理，这里在 dev 下自动把方舟地址改写过去，不必手填「代理地址」。
 * 生产构建里这个分支被裁掉，线上仍按用户填的 baseUrl / proxyUrl 走。
 */
function resolveBaseUrl(s: LlmSettings): string {
  const explicit = s.proxyUrl?.trim();
  if (explicit) return explicit;
  // typeof location 守卫：vitest 里 DEV 也为 true 但没有 window（live.test.ts 走 Node 直连）
  if (import.meta.env.DEV && typeof location !== "undefined" && s.baseUrl.startsWith(ARK_ORIGIN)) {
    return `${location.origin}/ark${s.baseUrl.slice(ARK_ORIGIN.length)}`;
  }
  return s.baseUrl;
}

export function buildArkModel(s: LlmSettings): Model<"openai-completions"> {
  const baseUrl = resolveBaseUrl(s).replace(/\/+$/, "");
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
