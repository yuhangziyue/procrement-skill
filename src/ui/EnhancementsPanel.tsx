import { useCallback, useEffect, useState } from "preact/hooks";
import type { EnhancementRow } from "../db/schema";
import {
  deleteEnhancement,
  listEnhancements,
  resolveConflict,
  toggleEnhancement,
  updateEnhancement,
  type EnhancementDraft,
} from "../db/enhancements";
import { EnhancementPreview } from "./EnhancementPreview";
import "./EnhancementsPanel.css";

interface Props {
  open: boolean;
  onClose: () => void;
  /** 任何启停 / 增删 / 编辑后调用，外层据此重建 Agent（system prompt 里的卡片变了） */
  onChanged: () => void;
}

const GROUPS: { origin: EnhancementRow["origin"]; label: string; hint: string }[] = [
  { origin: "taught", label: "我教的", hint: "对话里说「记住…」或点 👎 后教的，确认过才会出现在这里。" },
  { origin: "user", label: "我导入的", hint: "自己写的或导入的卡。" },
  { origin: "builtin", label: "内置", hint: "随小采自带。可以停用，不能删、不能改正文。" },
];

export function EnhancementsPanel({ open, onClose, onChanged }: Props) {
  const [rows, setRows] = useState<EnhancementRow[]>([]);
  const [editing, setEditing] = useState<EnhancementRow | null>(null);
  const [error, setError] = useState("");

  const reload = useCallback(async () => {
    setRows(await listEnhancements());
  }, []);

  useEffect(() => {
    if (!open) return;
    setError("");
    setEditing(null);
    reload();
  }, [open, reload]);

  if (!open) return null;

  const byId = new Map(rows.map((r) => [r.id, r]));

  const run = async (fn: () => Promise<unknown>) => {
    setError("");
    try {
      await fn();
      await reload();
      onChanged();
    } catch (e) {
      setError((e as Error).message || String(e));
    }
  };

  const onToggle = (r: EnhancementRow) => run(() => toggleEnhancement(r.id, !r.enabled));
  const onDelete = (r: EnhancementRow) => {
    if (!confirm(`删除《${r.name}》？删了就找不回来了。`)) return;
    return run(() => deleteEnhancement(r.id));
  };
  const onKeep = (keepId: string, dropId: string) => run(() => resolveConflict(keepId, dropId));
  const onSaveEdit = (edited: EnhancementDraft) => {
    const id = editing!.id;
    setEditing(null);
    return run(() => updateEnhancement(id, edited));
  };

  return (
    <div class="drawer-backdrop" onClick={onClose}>
      <aside class="drawer enh-drawer" onClick={(e) => e.stopPropagation()}>
        <header>
          <h3>增强卡</h3>
          <button class="btn-link" onClick={onClose}>关闭</button>
        </header>
        <p class="muted">每张卡 = 一个场景的做法。命中触发词时小采按卡执行。黄色 = 触发词和另一张重叠，点选留哪张。</p>
        {error && <div class="enh-error">⚠️ {error}</div>}

        {GROUPS.map((g) => {
          const list = rows.filter((r) => r.origin === g.origin);
          return (
            <section key={g.origin} class="enh-group">
              <h4>
                {g.label} <span class="enh-count">{list.length}</span>
              </h4>
              <p class="muted">{g.hint}</p>
              {list.length === 0 && <p class="muted enh-empty">暂无</p>}
              {list.map((r) => (
                <EnhCard
                  key={r.id}
                  row={r}
                  byId={byId}
                  onToggle={() => onToggle(r)}
                  onEdit={r.origin === "builtin" ? undefined : () => setEditing(r)}
                  onDelete={r.origin === "builtin" ? undefined : () => onDelete(r)}
                  onKeep={onKeep}
                />
              ))}
            </section>
          );
        })}
      </aside>

      {editing && (
        <EnhancementPreview
          draft={editing}
          conflicts={editing.conflictsWith.map((id) => byId.get(id)).filter((x): x is EnhancementRow => !!x)}
          existing={rows}
          onConfirm={onSaveEdit}
          onCancel={() => setEditing(null)}
        />
      )}
    </div>
  );
}

interface CardProps {
  row: EnhancementRow;
  byId: Map<string, EnhancementRow>;
  onToggle: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onKeep: (keepId: string, dropId: string) => void;
}

function EnhCard({ row, byId, onToggle, onEdit, onDelete, onKeep }: CardProps) {
  const [expanded, setExpanded] = useState(false);
  const conflicts = row.conflictsWith.map((id) => byId.get(id)).filter((x): x is EnhancementRow => !!x);
  const hasConflict = row.enabled && conflicts.length > 0;
  const hasBody = row.sop.length + row.cautions.length + row.examples.length > 0;

  return (
    <article class={`enh-card${hasConflict ? " enh-conflicted" : ""}${row.enabled ? "" : " enh-disabled"}`}>
      <div class="enh-card-head">
        <div class="enh-card-title">
          <strong>{row.name}</strong>
          {row.intents.length > 0 && <div class="enh-intent">{row.intents.join(" / ")}</div>}
        </div>
        <label class="enh-switch" title={row.enabled ? "已启用，点击停用" : "已停用，点击启用"}>
          <input type="checkbox" checked={row.enabled} onChange={onToggle} />
          <span class="enh-switch-track" />
        </label>
      </div>

      {row.triggers.length > 0 && (
        <div class="enh-chips">
          {row.triggers.map((t) => (
            <span key={t} class="enh-chip">{t}</span>
          ))}
        </div>
      )}

      {hasConflict &&
        conflicts.map((c) => (
          <div key={c.id} class="enh-conflict">
            与《{c.name}》触发词重叠 →
            <button class="btn enh-btn-sm" onClick={() => onKeep(row.id, c.id)}>保留这张</button>
            <button class="btn enh-btn-sm" onClick={() => onKeep(c.id, row.id)}>保留那张</button>
          </div>
        ))}

      <div class="enh-card-actions">
        {hasBody && (
          <button class="btn-link enh-btn-sm" onClick={() => setExpanded(!expanded)}>
            {expanded ? "收起" : "展开"}
          </button>
        )}
        {onEdit && <button class="btn-link enh-btn-sm" onClick={onEdit}>编辑</button>}
        {onDelete && <button class="btn-link enh-btn-sm enh-danger" onClick={onDelete}>删除</button>}
        {!onEdit && <span class="enh-lock">内置 · 不可改</span>}
      </div>

      {expanded && (
        <div class="enh-body">
          {row.sop.length > 0 && (
            <>
              <h5>流程</h5>
              <ol>{row.sop.map((s, i) => <li key={i}>{s}</li>)}</ol>
            </>
          )}
          {row.cautions.length > 0 && (
            <>
              <h5>注意</h5>
              <ul>{row.cautions.map((s, i) => <li key={i}>{s}</li>)}</ul>
            </>
          )}
          {row.examples.length > 0 && (
            <>
              <h5>示例</h5>
              <ul>{row.examples.map((s, i) => <li key={i}>{s}</li>)}</ul>
            </>
          )}
        </div>
      )}
    </article>
  );
}
