// 采姐的悬浮聊天窗。
// 为什么从常驻侧栏改成悬浮窗：侧栏永久占掉 360px，而看板才是主界面——
// 她一天里大部分时间在看卡片、不在聊天。改成"要用才召出来"的浮窗，主界面完整了，
// 聊天也从"一直杵在那"变成"随叫随到"。位置和大小记在 localStorage，下次开在原地。
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { FeedbackRow, SessionRow } from "../db/schema";
import { MessageList } from "./MessageList";
import { Composer } from "./Composer";
import { Sidebar } from "./Sidebar";
import { Icon } from "./icons";
import "./ChatDock.css";

const POS_KEY = "xiaocai.chatdock.rect";
const MIN_W = 320;
const MIN_H = 360;

interface Rect { x: number; y: number; w: number; h: number }

const defaultRect = (): Rect => ({
  x: Math.max(16, (typeof window === "undefined" ? 1280 : window.innerWidth) - 420 - 24),
  y: 84,
  w: 420,
  h: Math.min(620, (typeof window === "undefined" ? 800 : window.innerHeight) - 140),
});

function loadRect(): Rect {
  try {
    const raw = localStorage.getItem(POS_KEY);
    if (raw) return { ...defaultRect(), ...JSON.parse(raw) };
  } catch { /* 隐私模式 / 清过站点数据，用默认值就好 */ }
  return defaultRect();
}

/** 拖到屏幕外就再也点不回来了——每次落位都夹回可视区，至少留 120px 在里面 */
function clamp(r: Rect): Rect {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const w = Math.min(Math.max(r.w, MIN_W), Math.max(MIN_W, vw - 24));
  const h = Math.min(Math.max(r.h, MIN_H), Math.max(MIN_H, vh - 24));
  return { w, h, x: Math.min(Math.max(r.x, -w + 120), vw - 120), y: Math.min(Math.max(r.y, 0), vh - 48) };
}

export interface ChatDockProps {
  open: boolean;
  onOpen(): void;
  onClose(): void;
  sessions: SessionRow[];
  currentId?: string;
  title?: string;
  messages: AgentMessage[];
  streaming?: AgentMessage;
  feedback: Map<string, FeedbackRow>;
  busy: boolean;
  disabled: boolean;
  hint?: string;
  onSend(text: string): void;
  onAbort(): void;
  onSelectSession(id: string): void;
  onNewSession(): void;
  onDeleteSession(id: string): void;
  onFeedbackChange(): void;
  onTeach(messageId: string, note?: string): void;
  onSummarize(): void;
  canSummarize: boolean;
  onOpenPanel(p: "materials" | "enhancements" | "export"): void;
}

export function ChatDock(props: ChatDockProps) {
  const { open, onOpen, onClose } = props;
  const [rect, setRect] = useState<Rect>(loadRect);
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const drag = useRef<{ mode: "move" | "resize"; dx: number; dy: number; w: number; h: number } | null>(null);

  const persist = useCallback((r: Rect) => {
    try { localStorage.setItem(POS_KEY, JSON.stringify(r)); } catch { /* 存不下不影响使用 */ }
  }, []);

  // 指针事件统一处理拖动与缩放：用 pointer 而不是 mouse，触控板与触摸屏都走同一套
  useEffect(() => {
    if (!open) return;
    const move = (e: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      setRect((r) => clamp(d.mode === "move"
        ? { ...r, x: e.clientX - d.dx, y: e.clientY - d.dy }
        : { ...r, w: d.w + (e.clientX - d.dx), h: d.h + (e.clientY - d.dy) }));
    };
    const up = () => {
      if (!drag.current) return;
      drag.current = null;
      document.body.classList.remove("dock-dragging");
      setRect((r) => { persist(r); return r; });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [open, persist]);

  // 窗口缩小后浮窗可能落到视口外，重新夹一次
  useEffect(() => {
    const onResize = () => setRect((r) => clamp(r));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const startMove = (e: PointerEvent) => {
    if ((e.target as HTMLElement).closest("button")) return; // 操作栏按钮不触发拖动
    drag.current = { mode: "move", dx: e.clientX - rect.x, dy: e.clientY - rect.y, w: rect.w, h: rect.h };
    document.body.classList.add("dock-dragging");
  };
  const startResize = (e: PointerEvent) => {
    e.stopPropagation();
    drag.current = { mode: "resize", dx: e.clientX, dy: e.clientY, w: rect.w, h: rect.h };
    document.body.classList.add("dock-dragging");
  };

  if (!open) {
    return (
      <button class="chat-fab" onClick={onOpen} title="问采姐（⌘K）" aria-label="打开采姐对话">
        <Icon name="chat" size={20} />
        <span class="chat-fab-label">问采姐</span>
      </button>
    );
  }

  return (
    <section
      class="chat-dock"
      style={{ left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.w}px`, height: `${rect.h}px` }}
      aria-label="采姐对话窗口"
    >
      <header class="dock-bar" onPointerDown={startMove as any}>
        <span class="dock-grip" aria-hidden="true"><Icon name="drag" size={14} /></span>
        <span class="dock-title" title={props.title}>{props.title || "采姐"}</span>
        <div class="dock-actions">
          <button class="ico-btn" onClick={() => setSessionsOpen(!sessionsOpen)} title="历史会话" aria-label="历史会话"><Icon name="history" size={15} /></button>
          <button class="ico-btn" onClick={props.onNewSession} title="新会话" aria-label="新会话"><Icon name="plus" size={15} /></button>
          <button class="ico-btn" onClick={props.onSummarize} disabled={!props.canSummarize} title="做成留痕小结" aria-label="小结"><Icon name="summary" size={15} /></button>
          <span class="dock-sep" />
          <button class="ico-btn" onClick={() => props.onOpenPanel("materials")} title="资料库" aria-label="资料库"><Icon name="folder" size={15} /></button>
          <button class="ico-btn" onClick={() => props.onOpenPanel("enhancements")} title="增强卡" aria-label="增强卡"><Icon name="card" size={15} /></button>
          <button class="ico-btn" onClick={() => props.onOpenPanel("export")} title="导出备份" aria-label="导出备份"><Icon name="export" size={15} /></button>
          <span class="dock-sep" />
          <button class="ico-btn danger" onClick={onClose} title="关闭（对话不会丢）" aria-label="关闭"><Icon name="close" size={15} /></button>
        </div>
      </header>

      {sessionsOpen && (
        <div class="dock-sessions">
          <Sidebar
            sessions={props.sessions}
            currentId={props.currentId}
            onSelect={(id) => { setSessionsOpen(false); props.onSelectSession(id); }}
            onNew={props.onNewSession}
            onDelete={props.onDeleteSession}
          />
        </div>
      )}

      {props.hint && <div class="dock-hint"><Icon name="info" size={14} tone="warn" /><span>{props.hint}</span></div>}

      {props.currentId && (
        <MessageList
          sessionId={props.currentId}
          messages={props.messages}
          streaming={props.streaming}
          feedback={props.feedback}
          onFeedbackChange={props.onFeedbackChange}
          onTeach={props.onTeach}
        />
      )}
      <Composer disabled={props.disabled} streaming={props.busy} onSend={props.onSend} onAbort={props.onAbort} />

      <span class="dock-resize" onPointerDown={startResize as any} title="拖动改变大小" aria-hidden="true" />
    </section>
  );
}
