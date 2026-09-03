import { useEffect, useRef, useState } from "preact/hooks";
import { format } from "date-fns";
import { db } from "../db/schema";
import { getSetting } from "../db/settings";
import {
  EXPORTED_AT_KEY,
  downloadBlob,
  exportAll,
  exportEnhancements,
  exportSessionMarkdown,
  importAll,
  importEnhancements,
  safeFilename,
  stampNow,
  type ImportCounts,
} from "../db/export";
import "./ExportPanel.css";

interface Props {
  open: boolean;
  onClose: () => void;
  currentSessionId?: string;
  /** 导入备份 / 增强卡成功后回调，宿主可刷新会话列表或重建 Agent */
  onImported?: () => void;
}

type Status = { kind: "ok" | "error"; text: string };

export function ExportPanel({ open, onClose, currentSessionId, onImported }: Props) {
  const [includeMaterials, setIncludeMaterials] = useState(false);
  const [lastExportedAt, setLastExportedAt] = useState<string>();
  const [busy, setBusy] = useState<string>();
  const [status, setStatus] = useState<Status>();
  const backupRef = useRef<HTMLInputElement>(null);
  const cardsRef = useRef<HTMLInputElement>(null);

  const loadLast = async () => setLastExportedAt(await getSetting<string | undefined>(EXPORTED_AT_KEY, undefined));

  useEffect(() => {
    if (!open) return;
    setStatus(undefined);
    setIncludeMaterials(false);
    loadLast();
  }, [open]);

  if (!open) return null;

  const run = async (label: string, fn: () => Promise<string>) => {
    setBusy(label);
    setStatus(undefined);
    try {
      const text = await fn();
      setStatus({ kind: "ok", text });
    } catch (err: any) {
      setStatus({ kind: "error", text: `${label}失败：${err?.message ?? String(err)}` });
    } finally {
      setBusy(undefined);
    }
  };

  const doExportAll = () =>
    run("导出全部", async () => {
      const blob = await exportAll({ includeMaterials });
      downloadBlob(blob, `xiaocai-backup-${stampNow()}.json`);
      await loadLast();
      return `已导出全部数据${includeMaterials ? "（含资料库）" : "（不含资料库）"}，${(blob.size / 1024).toFixed(0)} KB`;
    });

  const doExportSession = () =>
    run("导出会话", async () => {
      if (!currentSessionId) throw new Error("当前没有打开的会话");
      const md = await exportSessionMarkdown(currentSessionId);
      const s = await db.sessions.get(currentSessionId);
      downloadBlob(new Blob([md], { type: "text/markdown;charset=utf-8" }), `xiaocai-${safeFilename(s?.title ?? "session")}-${stampNow()}.md`);
      return "已导出当前会话为 Markdown";
    });

  const doExportCards = () =>
    run("导出增强卡", async () => {
      const blob = await exportEnhancements();
      downloadBlob(blob, `xiaocai-enhancements-${stampNow()}.json`);
      return "已导出自建增强卡（不含内置卡）";
    });

  const onBackupPicked = async (e: Event) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    if (!confirm("导入备份会与现有数据合并（同 id 覆盖，不清空现有数据）。继续？")) return;
    await run("导入备份", async () => {
      const { counts } = await importAll(file);
      onImported?.();
      return `已合并导入：${describeCounts(counts)}`;
    });
  };

  const onCardsPicked = async (e: Event) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    await run("导入增强卡", async () => {
      const r = await importEnhancements(file);
      onImported?.();
      return `已导入 ${r.imported} 张增强卡${r.renamed ? `（${r.renamed} 张因 id 冲突已换新 id）` : ""}`;
    });
  };

  return (
    <div class="drawer-backdrop" onClick={onClose}>
      <aside class="drawer export-drawer" onClick={(e) => e.stopPropagation()}>
        <header>
          <h3>导出 / 备份</h3>
          <button class="btn-link" onClick={onClose}>关闭</button>
        </header>

        <section>
          <h4>导出</h4>
          <p class="muted">
            所有数据只在这台浏览器里。上次导出：
            {lastExportedAt ? <b class="export-last">{format(new Date(lastExportedAt), "yyyy-MM-dd HH:mm")}</b> : <b class="export-last export-never">从未导出</b>}
          </p>
          <div class="export-row">
            <button class="btn btn-primary" disabled={!!busy} onClick={doExportAll}>
              {busy === "导出全部" ? "导出中…" : "导出全部（JSON）"}
            </button>
            <label class="export-check">
              <input type="checkbox" checked={includeMaterials} onChange={(e) => setIncludeMaterials((e.target as HTMLInputElement).checked)} />
              包含资料库原文件（体积会变大）
            </label>
          </div>
          <p class="export-hint">全量备份含会话、消息、小结、增强卡、反馈、设置；API Key 永远不会进导出包。</p>

          <div class="export-row">
            <button class="btn" disabled={!!busy || !currentSessionId} onClick={doExportSession} title={currentSessionId ? "" : "先打开一个会话"}>
              导出当前会话（Markdown）
            </button>
            <button class="btn" disabled={!!busy} onClick={doExportCards}>导出增强卡（JSON）</button>
          </div>
        </section>

        <section>
          <h4>导入</h4>
          <input ref={backupRef} type="file" accept=".json,application/json" hidden onChange={onBackupPicked} />
          <input ref={cardsRef} type="file" accept=".json,application/json" hidden onChange={onCardsPicked} />
          <div class="export-row">
            <button class="btn" disabled={!!busy} onClick={() => backupRef.current?.click()}>导入备份</button>
            <button class="btn" disabled={!!busy} onClick={() => cardsRef.current?.click()}>导入增强卡</button>
          </div>
          <p class="export-hint">导入是合并，不会清掉现有数据；增强卡 id 撞了会自动换新 id，来源记为「用户」。</p>
        </section>

        {status && <p class={`export-status ${status.kind === "ok" ? "ok" : "error"}`}>{status.text}</p>}
      </aside>
    </div>
  );
}

function describeCounts(c: ImportCounts): string {
  const parts: string[] = [];
  if (c.sessions) parts.push(`会话 ${c.sessions}`);
  if (c.messages) parts.push(`消息 ${c.messages}`);
  if (c.summaries) parts.push(`小结 ${c.summaries}`);
  if (c.enhancements) parts.push(`增强卡 ${c.enhancements}`);
  if (c.feedback) parts.push(`反馈 ${c.feedback}`);
  if (c.settings) parts.push(`设置 ${c.settings}`);
  if (c.materials) parts.push(`资料 ${c.materials}`);
  return parts.length ? parts.join(" · ") : "文件里没有可导入的数据";
}
