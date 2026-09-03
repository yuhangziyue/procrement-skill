import { useEffect, useRef, useState } from "preact/hooks";
import { format } from "date-fns";
import type { MaterialRow } from "../db/schema";
import {
  ROLE_LABELS,
  deleteMaterial,
  detectRole,
  importMaterial,
  listActiveMaterials,
  parseMaterialFile,
  type DiffSummary,
  type MaterialRole,
} from "../db/materials";
import "./MaterialsPanel.css";

interface Props {
  open: boolean;
  onClose: () => void;
  /** 导入 / 删除成功后回调，宿主可借此刷新 Agent 的资料上下文 */
  onChanged?: () => void;
}

const ROLE_ORDER: MaterialRole[] = ["materials", "tracking", "suppliers", "doc"];
const LOCAL_NOTICE = "资料只保存在这台浏览器里，清缓存会清空，记得定期导出。";

interface Pending {
  file: File;
  detected?: MaterialRole;
  role: MaterialRole | "";
  name: string;
  rowCount?: number;
}

interface Done {
  row: MaterialRow;
  summary?: DiffSummary;
  previousVersion?: number;
}

export function MaterialsPanel({ open, onClose, onChanged }: Props) {
  const [list, setList] = useState<MaterialRow[]>([]);
  const [pending, setPending] = useState<Pending>();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Done>();
  const [error, setError] = useState<string>();
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = async () => setList(await listActiveMaterials());

  useEffect(() => {
    if (!open) return;
    setPending(undefined);
    setDone(undefined);
    setError(undefined);
    refresh();
  }, [open]);

  if (!open) return null;

  const onPick = async (e: Event) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    setError(undefined);
    setDone(undefined);
    setBusy(true);
    try {
      const parsed = await parseMaterialFile(file);
      const detected = parsed.rows ? detectRole(parsed.headers) : "doc";
      setPending({ file, detected, role: detected ?? "", name: file.name.replace(/\.[^.]+$/, ""), rowCount: parsed.rows?.length });
    } catch (err: any) {
      setError(`读不了这个文件：${err?.message ?? String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const doImport = async () => {
    if (!pending || !pending.role) return;
    setBusy(true);
    setError(undefined);
    try {
      const r = await importMaterial(pending.file, pending.role, pending.name);
      setDone({ row: r.row, summary: r.summary, previousVersion: r.previousVersion });
      setPending(undefined);
      await refresh();
      onChanged?.();
    } catch (err: any) {
      setError(`导入失败：${err?.message ?? String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const doDelete = async (m: MaterialRow) => {
    if (!confirm(`删除「${m.name}」的全部版本？（只影响这台浏览器）`)) return;
    await deleteMaterial(m.id);
    setDone(undefined);
    await refresh();
    onChanged?.();
  };

  const grouped = ROLE_ORDER.map((role) => ({ role, items: list.filter((m) => m.role === role) })).filter((g) => g.items.length);

  return (
    <div class="drawer-backdrop" onClick={onClose}>
      <aside class="drawer materials-drawer" onClick={(e) => e.stopPropagation()}>
        <header>
          <h3>资料库</h3>
          <button class="btn-link" onClick={onClose}>关闭</button>
        </header>

        <section>
          <h4>导入资料</h4>
          <p class="muted">支持 .csv / .xlsx（只读第一个工作表）。物料表、跟单表、供应商档案会按列名自动识别；模板见仓库 templates/。</p>
          <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls,.md,.txt" hidden onChange={onPick} />
          {!pending && (
            <button class="btn" disabled={busy} onClick={() => fileRef.current?.click()}>
              {busy ? "解析中…" : "选择文件"}
            </button>
          )}

          {pending && (
            <div class="materials-pending">
              <div class="materials-pending-file">
                <strong>{pending.file.name}</strong>
                <span class="muted">{pending.rowCount != null ? `${pending.rowCount} 行` : "文本文件"}</span>
              </div>
              {pending.detected ? (
                <p class="materials-detected">识别为「{ROLE_LABELS[pending.detected]}」</p>
              ) : (
                <p class="materials-undetected">没认出这是哪类资料，请手动选：</p>
              )}
              <label>
                资料类型
                <select class="materials-select" value={pending.role} onChange={(e) => setPending({ ...pending, role: (e.target as HTMLSelectElement).value as MaterialRole })}>
                  <option value="" disabled>请选择</option>
                  {ROLE_ORDER.map((r) => (
                    <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                  ))}
                </select>
              </label>
              <label>
                资料名称（同名再导入 = 新版本，会给出差异摘要）
                <input value={pending.name} onInput={(e) => setPending({ ...pending, name: (e.target as HTMLInputElement).value })} />
              </label>
              <div class="materials-actions">
                <button class="btn btn-primary" disabled={busy || !pending.role || !pending.name.trim()} onClick={doImport}>
                  {busy ? "导入中…" : "导入"}
                </button>
                <button class="btn" disabled={busy} onClick={() => setPending(undefined)}>取消</button>
              </div>
            </div>
          )}

          {done && (
            <div class="materials-done">
              <p class="ok materials-done-title">
                已导入「{done.row.name}」v{done.row.version}
                {done.row.rows ? ` · ${done.row.rows.length} 行` : ""}
              </p>
              {done.summary && (
                <p class="materials-diff">
                  相比 v{done.previousVersion}：新增 <b>{done.summary.added}</b> / 删除 <b>{done.summary.removed}</b> / 状态变化 <b>{done.summary.statusChanged}</b>
                  {done.summary.rowsChanged > done.summary.statusChanged ? `（另有 ${done.summary.rowsChanged - done.summary.statusChanged} 行其他字段有改动）` : ""}
                </p>
              )}
              {done.previousVersion && !done.summary && <p class="muted">已覆盖为新版本（该类型不做逐行比对）。</p>}
              <p class="materials-notice">⚠️ {LOCAL_NOTICE}</p>
            </div>
          )}
          {error && <p class="error materials-error">{error}</p>}
        </section>

        <section>
          <h4>已有资料</h4>
          {grouped.length === 0 && <p class="muted">还没有导入任何资料。</p>}
          {grouped.map((g) => (
            <div key={g.role} class="materials-group">
              <div class="materials-group-title">{ROLE_LABELS[g.role]}</div>
              <ul class="materials-list">
                {g.items.map((m) => (
                  <li key={m.id} class="materials-item">
                    <div class="materials-item-main">
                      <div class="materials-item-name">{m.name}</div>
                      <div class="materials-item-meta">
                        {m.rows ? `${m.rows.length} 行` : m.text ? `${m.text.length} 字` : "—"} · v{m.version} · {format(new Date(m.createdAt), "MM-dd HH:mm")}
                      </div>
                    </div>
                    <button class="btn-icon" title="删除全部版本" onClick={() => doDelete(m)}>删除</button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      </aside>
    </div>
  );
}
