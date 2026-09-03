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

export const DEFAULT_LLM: LlmSettings = {
  baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
  modelId: "doubao-seed-2.0-pro",
};

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

export const getLlmSettings = () => getSetting<LlmSettings>("llm", DEFAULT_LLM);
export const setLlmSettings = (v: LlmSettings) => setSetting("llm", v);
export const getCompanyConfig = () => getSetting<CompanyConfig>("company", {});
export const setCompanyConfig = (v: CompanyConfig) => setSetting("company", v);
