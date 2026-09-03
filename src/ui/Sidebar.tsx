import type { SessionRow } from "../db/schema";

interface Props {
  sessions: SessionRow[];
  currentId?: string;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
}

export function Sidebar({ sessions, currentId, onSelect, onNew, onDelete }: Props) {
  return (
    <nav class="sidebar">
      <div class="brand">
        <span class="logo">采</span>
        <div>
          <strong>小采</strong>
          <small>采购新人的 AI 师姐</small>
        </div>
      </div>
      <button class="btn btn-block" onClick={onNew}>＋ 新会话</button>
      <ul class="session-list">
        {sessions.map((s) => (
          <li key={s.id} class={s.id === currentId ? "active" : ""}>
            <button class="session-btn" onClick={() => onSelect(s.id)} title={s.title}>
              {s.title || "新会话"}
            </button>
            <button class="btn-icon" title="删除" onClick={() => onDelete(s.id)}>×</button>
          </li>
        ))}
      </ul>
      <p class="privacy">🔒 对话与资料只保存在这台浏览器里</p>
    </nav>
  );
}
