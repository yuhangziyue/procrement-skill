import { useEffect, useState } from "preact/hooks";
import {
  DEFAULT_LLM,
  LLM_PRESETS,
  explainLlmError,
  needsProxy,
  DEV_LOCKED,
  getApiKey,
  usingBundledKey,
  getCompanyConfig,
  getLlmSettings,
  setApiKey,
  setCompanyConfig,
  setLlmSettings,
  type CompanyConfig,
  type LlmSettings,
} from "../db/settings";
import { Icon } from "./icons";

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}

const COMPANY_FIELDS: { key: keyof CompanyConfig; label: string; hint: string }[] = [
  { key: "product", label: "用友产品与版本", hint: "U8+ / T+ / U9 cloud / YonSuite" },
  { key: "requisition", label: "是否走请购单", hint: "如：不走，采购直接开订单" },
  { key: "arrivalDoc", label: "有无到货单环节 / 质检", hint: "如：订单→到货单→入库单，包材免检" },
  { key: "permission", label: "采购员权限边界", hint: "如：能审核订单；入库单仓库录仓库审" },
  { key: "trackingReport", label: "跟踪用的报表名", hint: "如：采购订单执行情况统计表" },
];

export function SettingsPanel({ open, onClose, onSaved }: Props) {
  const [key, setKey] = useState("");
  const [llm, setLlm] = useState<LlmSettings>(DEFAULT_LLM);
  const [company, setCompany] = useState<CompanyConfig>({});
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState<{ kind: "loading" | "ok" | "error"; text: string }>();

  /** 代理地址常见误填：VPN/Clash 的本地端口（127.0.0.1:7890）是正向代理，不是反向代理，POST 过去只会得到 400 */
  const proxyLooksLikeForwardProxy = (() => {
    const u = llm.proxyUrl?.trim();
    if (!u) return false;
    try {
      const url = new URL(u);
      return url.pathname === "/" || /:(7890|7891|7897|1080|8080|8888|10808|10809)$/.test(url.host);
    } catch {
      return true;
    }
  })();

  const testConnection = async () => {
    setTesting({ kind: "loading", text: "连接中…" });
    const base = (llm.proxyUrl?.trim() || llm.baseUrl).replace(/\/+$/, "");
    try {
      const r = await fetch(`${base}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${key.trim()}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: llm.modelId.trim(), messages: [{ role: "user", content: "ping" }], max_tokens: 1 }),
      });
      if (r.ok) setTesting({ kind: "ok", text: "连通：端点、Key、模型都对" });
      else {
        const t = await r.text();
        setTesting({ kind: "error", text: `HTTP ${r.status}：${explainLlmError(`${r.status} ${t.slice(0, 200)}`, llm)}` });
      }
    } catch (e: any) {
      setTesting({ kind: "error", text: explainLlmError(String(e?.message ?? e), llm) });
    }
  };

  useEffect(() => {
    if (!open) return;
    setKey(getApiKey());
    getLlmSettings().then(setLlm);
    getCompanyConfig().then(setCompany);
    setSaved(false);
  }, [open]);

  if (!open) return null;

  const save = async () => {
    setApiKey(key);
    await setLlmSettings({ ...llm, baseUrl: llm.baseUrl.trim(), modelId: llm.modelId.trim(), proxyUrl: llm.proxyUrl?.trim() || undefined });
    await setCompanyConfig(company);
    setSaved(true);
    onSaved();
  };

  return (
    <div class="drawer-backdrop" onClick={onClose}>
      <aside class="drawer" onClick={(e) => e.stopPropagation()}>
        <header>
          <h3>设置</h3>
          <button class="btn-link" onClick={onClose}>关闭</button>
        </header>

        <section>
          <h4>模型接入</h4>
          <p class="muted">Key 只保存在这台浏览器的 localStorage，不会上传、不会进导出包。</p>
          {DEV_LOCKED && (
            <p class="muted"><Icon name="info" size={13} tone="muted" /> 本地开发中：Base URL 与模型由 .env.local 锁定，请求自动经 Vite 代理转发；要换端点请改 .env.local。</p>
          )}
          <div class="presets">
            {LLM_PRESETS.map((p) => (
              <button
                key={p.id}
                class={`btn preset${llm.baseUrl === p.value.baseUrl ? " active" : ""}`}
                title={p.hint}
                onClick={() => setLlm({ ...llm, ...p.value, proxyUrl: p.value.proxyUrl ?? (p.id === "ark-standard" ? undefined : llm.proxyUrl) })}
              >
                {p.label}
              </button>
            ))}
          </div>
          <p class="muted">{LLM_PRESETS.find((p) => p.value.baseUrl === llm.baseUrl)?.hint}</p>
          <label>
            API Key
            <input type="password" value={key} onInput={(e) => setKey((e.target as HTMLInputElement).value)} placeholder="火山方舟 API Key" />
            {usingBundledKey() && (
              <small class="muted">
                已内置一把默认 Key，装上就能聊 —— 想换成自己的，直接覆盖这里再保存。
                （Key 只存在这台机器上：不进仓库、不进网页版、导出备份时也会剔除。）
              </small>
            )}
          </label>
          <label>
            Base URL
            <input value={llm.baseUrl} onInput={(e) => setLlm({ ...llm, baseUrl: (e.target as HTMLInputElement).value })} />
          </label>
          <label>
            模型 ID
            <input value={llm.modelId} onInput={(e) => setLlm({ ...llm, modelId: (e.target as HTMLInputElement).value })} placeholder="doubao-seed-2.0-pro" />
          </label>
          {needsProxy(llm) && (
            <p class="warn-inline">
              <Icon name="warning" size={14} tone="warn" />
              <span>Coding Plan 端点浏览器不能直连，必须填下面的代理地址（部署 proxy/worker.js 后得到的 https://…workers.dev），否则发消息会报 Connection error。</span>
            </p>
          )}
          {proxyLooksLikeForwardProxy && (
            <p class="warn-inline">
              <Icon name="warning" size={14} tone="warn" />
              <span>这个地址看起来是 VPN / Clash 的本地代理端口。它是<b>正向代理</b>（浏览器整体走它上网），不是给页面转发接口的<b>反向代理</b>，填在这里只会得到 400。这里要填的是 Worker 地址（https://…workers.dev）或本机 dev server 的 <code>http://localhost:5173/ark/coding/v3</code>。</span>
            </p>
          )}
          <label>
            代理地址（可选）
            <input value={llm.proxyUrl ?? ""} onInput={(e) => setLlm({ ...llm, proxyUrl: (e.target as HTMLInputElement).value })} placeholder="Coding Plan 端点不放行浏览器直连时填 Worker 地址" />
          </label>
        </section>

        <section>
          <h4>公司配置（五问）</h4>
          <p class="muted">这五项是你公司的 ERP 实施方式，不是知识。没填之前，小采说到菜单路径会自动带「⚠️ 待实机核对」。</p>
          {COMPANY_FIELDS.map((f) => (
            <label key={f.key}>
              {f.label}
              <input value={company[f.key] ?? ""} placeholder={f.hint} onInput={(e) => setCompany({ ...company, [f.key]: (e.target as HTMLInputElement).value })} />
            </label>
          ))}
        </section>

        <footer>
          <button class="btn btn-primary" onClick={save}>保存</button>
          <button class="btn" onClick={testConnection} disabled={!key.trim()}>测试连接</button>
          {testing && (
            <span class={testing.kind === "error" ? "error" : testing.kind === "ok" ? "ok" : "muted"} style="margin-left:8px">
              {testing.kind === "ok" && <Icon name="done" size={14} tone="ok" />}
              {testing.kind === "error" && <Icon name="alert" size={14} tone="danger" />}
              {" "}{testing.text}
            </span>
          )}
          {saved && <span class="ok"><Icon name="check" size={14} tone="ok" /> 已保存，下一条消息起生效</span>}
        </footer>
      </aside>
    </div>
  );
}
