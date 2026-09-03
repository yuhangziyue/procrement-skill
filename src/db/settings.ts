// 设置读写。apiKey 只放 localStorage（导出全量 JSON 时天然不带）；其余放 IndexedDB settings 表。
import { db } from "./schema";

export interface CompanyConfig {
  /** 02-u8-basics §0 五个待验项：任一为空 ⇒ 菜单路径类回答自动带 ⚠️ */
  product?: string; // U8+ / T+ / U9 / YonSuite
  requisition?: string; // 是否走请购单
  arrivalDoc?: string; // 有无到货单环节 / 质检
  permission?: string; // 采购员权限边界
  trackingReport?: string; // 跟踪用的报表名
}

export interface LlmSettings {
  baseUrl: string;
  modelId: string;
  /** 可选：CORS 代理地址；填了就把它当 baseUrl 用 */
  proxyUrl?: string;
}

// 本地开发时默认值取 .env.local（VITE_ARK_BASE_URL / VITE_ARK_MODEL），省得每次手填；
// 线上构建没有 .env.local，回落到标准端点。Key 故意不从 env 读：避免本地 build 把 Key 烤进 dist。
const ENV_BASE = import.meta.env.DEV ? (import.meta.env.VITE_ARK_BASE_URL as string | undefined) : undefined;
const ENV_MODEL = import.meta.env.DEV ? (import.meta.env.VITE_ARK_MODEL as string | undefined) : undefined;

export const ARK_STANDARD_URL = "https://ark.cn-beijing.volces.com/api/v3";
export const ARK_CODING_URL = "https://ark.cn-beijing.volces.com/api/coding/v3";
/** 站点自带的 Coding Plan 代理（Cloudflare Worker，透传模式不存 Key）。部署后填入。 */
export const DEFAULT_PROXY_URL = "";

export const LLM_PRESETS: { id: string; label: string; hint: string; value: LlmSettings }[] = [
  {
    id: "coding-plan",
    label: "方舟 Coding Plan（经代理）",
    hint: "订阅制、边际成本≈0。Coding Plan 端点不放行浏览器直连，请求经 Worker 代理转一道；Key 仍只在你浏览器里。",
    value: { baseUrl: ARK_CODING_URL, modelId: "doubao-seed-2.0-pro", proxyUrl: DEFAULT_PROXY_URL || undefined },
  },
  {
    id: "ark-standard",
    label: "方舟标准端点（浏览器直连）",
    hint: "按 token 计费；需先在方舟控制台开通对应模型。零代理。",
    value: { baseUrl: ARK_STANDARD_URL, modelId: "doubao-seed-2.0-pro" },
  },
];

// 默认预设：站点还没内置代理地址时，默认走浏览器能直连的标准端点——Coding Plan 端点不配代理必挂（线上 2026-09-03 实测 "Connection error."）。
// Worker 部署后把 DEFAULT_PROXY_URL 填上，默认就自动切回 Coding Plan。
const DEFAULT_PRESET = DEFAULT_PROXY_URL ? LLM_PRESETS[0] : LLM_PRESETS[1];
export const DEFAULT_LLM: LlmSettings = {
  ...DEFAULT_PRESET.value,
  baseUrl: ENV_BASE?.trim() || DEFAULT_PRESET.value.baseUrl,
  modelId: ENV_MODEL?.trim() || DEFAULT_PRESET.value.modelId,
};

/** Coding Plan 端点 + 没填代理 ⇒ 浏览器一定连不上；给 UI 用的前置判断 */
export function needsProxy(s: LlmSettings): boolean {
  return s.baseUrl.startsWith(ARK_CODING_URL) && !s.proxyUrl?.trim() && !(import.meta.env.DEV && typeof location !== "undefined");
}

/** 把 SDK / 网络层的黑话翻译成使用者能动手的话 */
export function explainLlmError(msg: string, s?: LlmSettings): string {
  const m = msg.toLowerCase();
  if (/connection error|failed to fetch|networkerror|load failed/.test(m)) {
    return s && needsProxy(s)
      ? "浏览器无法直连 Coding Plan 端点（服务端 CORS 不放行）。去「设置」填代理地址，或切换到「方舟标准端点」预设。"
      : "网络连不上模型端点：检查网络 / 代理地址是否正确、是否在线。";
  }
  if (/401|authentication|api key/.test(m)) return "Key 无效或格式不对：去「设置」重新粘贴 API Key（方舟 Key 以 ark- 开头）。";
  if (/404|notfound|does not exist|no access/.test(m)) return "这个模型在当前端点不可用：标准端点需先在方舟控制台开通对应模型；Coding Plan 模型只在 coding 端点可用。";
  if (/429|rate|quota|1400001/.test(m)) return "触发限流或额度用完，稍后再试。";
  return msg;
}

const KEY_STORAGE = "xiaocai.apiKey";

export function getApiKey(): string {
  try {
    return localStorage.getItem(KEY_STORAGE) ?? "";
  } catch {
    return "";
  }
}

export function setApiKey(key: string) {
  try {
    if (key) localStorage.setItem(KEY_STORAGE, key.trim());
    else localStorage.removeItem(KEY_STORAGE);
  } catch {
    /* 隐私模式等场景写不进去，页面仍可用（每次手填） */
  }
}

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const row = await db.settings.get(key);
  return (row?.value as T) ?? fallback;
}

export async function setSetting(key: string, value: unknown) {
  await db.settings.put({ key, value });
}

/** 本地开发且 .env.local 给了 BASE_URL/MODEL ⇒ 这两项以 env 为准，浏览器里存过什么都不影响（避免旧值 /api/v3 反复 404）。 */
export const DEV_LOCKED = import.meta.env.DEV && !!(ENV_BASE?.trim() || ENV_MODEL?.trim());

export async function getLlmSettings(): Promise<LlmSettings> {
  const s = await getSetting<LlmSettings>("llm", DEFAULT_LLM);
  if (!DEV_LOCKED) return s;
  return { ...s, baseUrl: ENV_BASE?.trim() || s.baseUrl, modelId: ENV_MODEL?.trim() || s.modelId };
}
export const setLlmSettings = (v: LlmSettings) => setSetting("llm", v);
export const getCompanyConfig = () => getSetting<CompanyConfig>("company", {});
export const setCompanyConfig = (v: CompanyConfig) => setSetting("company", v);
