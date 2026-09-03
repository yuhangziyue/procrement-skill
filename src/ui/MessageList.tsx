import { useLayoutEffect, useRef } from "preact/hooks";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { FeedbackRow } from "../db/schema";
import { renderMarkdown } from "../util/markdown";
import { FeedbackBar } from "./FeedbackBar";

interface Props {
  sessionId: string;
  messages: AgentMessage[];
  streaming?: AgentMessage;
  feedback: Map<string, FeedbackRow>;
  onFeedbackChange: () => void;
  onTeach: (messageId: string, note?: string) => void;
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content))
    return content
      .filter((c: any) => c?.type === "text")
      .map((c: any) => c.text)
      .join("\n");
  return "";
}

/** 消息 id 与 app.tsx 里 persist 的规则一致：sessionId:index */
export const messageId = (sessionId: string, index: number) => `${sessionId}:${index}`;

function AssistantBubble({ m, live }: { m: any; live?: boolean }) {
  const blocks = (m.content ?? []) as any[];
  return (
    <div class="bubble">
      {blocks.map((b, i) => {
        if (b.type === "text") return <div key={i} class="md" dangerouslySetInnerHTML={{ __html: renderMarkdown(b.text || "") }} />;
        if (b.type === "toolCall")
          return (
            <div key={i} class="tool-call">
              <span class="tool-tag">🔧 {b.name}</span>
              <pre>{JSON.stringify(b.arguments, null, 2)}</pre>
            </div>
          );
        return null;
      })}
      {m.stopReason === "error" && <div class="error">⚠️ {m.errorMessage || "请求失败"}</div>}
      {live && <span class="cursor">▍</span>}
    </div>
  );
}

const ADOPTABLE = new Set(["calc_order_qty", "backward_schedule", "check_po", "arrival_notice", "track_status"]);

/** 离底部多少像素以内算「贴着底」；用户往上翻超过这个距离，流式更新就不再抢滚动条 */
const STICK_THRESHOLD = 48;

export function MessageList({ sessionId, messages, streaming, feedback, onFeedbackChange, onTeach }: Props) {
  const all = streaming ? [...messages, streaming] : messages;
  const listRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  // 流式消息每来一段 token 就变长；用序列化长度当依赖，比深比较便宜
  const streamLen = streaming ? JSON.stringify((streaming as any).content ?? "").length : 0;

  const onScroll = () => {
    const el = listRef.current;
    if (!el) return;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_THRESHOLD;
  };
  // scroll 事件要到下一帧才派发，流式渲染夹在中间会先把滚动条拽回底部再收到「用户上翻了」（2026-09-03 实测）。
  // 所以用与用户动作同步的 wheel / touchmove 立刻解除贴底；回到底部时再由 onScroll 重新贴上。
  const onWheel = (e: WheelEvent) => {
    if (e.deltaY < 0) stick.current = false;
  };
  const onTouchMove = () => {
    stick.current = false;
  };

  // 内容变化后、浏览器绘制前把滚动条贴底，避免先看到跳动。
  // 切会话 / 用户自己发了新消息 ⇒ 无条件回底。Agent 中途产生的工具调用 / 工具结果也会让 messages 变长，
  // 那不算用户动作，不能借此把上翻中的用户拽回底部（2026-09-03 实测踩到）。仅流式增长 ⇒ 尊重用户是否上翻。
  const prev = useRef({ sessionId, len: messages.length });
  useLayoutEffect(() => {
    const lastIsUser = (messages[messages.length - 1] as any)?.role === "user";
    const sessionChanged = prev.current.sessionId !== sessionId;
    const userSent = prev.current.len !== messages.length && lastIsUser;
    if (sessionChanged || userSent) stick.current = true;
    prev.current = { sessionId, len: messages.length };
    const el = listRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [sessionId, messages.length, all.length, streamLen]);

  return (
    <div class="messages" ref={listRef} onScroll={onScroll} onWheel={onWheel} onTouchMove={onTouchMove}>
      {all.length === 0 && (
        <div class="empty">
          <h2>你好，我是小采。</h2>
          <p>采购新人的 AI 师姐——下单前先算账、到货前发预告、逾期了怎么催，都可以问我。</p>
          <p class="hint">试试：「腰封 A 生产表要 3000 只，可用库存 800，在途 500，MOQ 2000，该下多少？」</p>
        </div>
      )}
      {all.map((m: any, i) => {
        const live = !!streaming && i === all.length - 1;
        const id = messageId(sessionId, i);
        if (m.role === "user")
          return (
            <div key={i} class="msg msg-user">
              <div class="bubble">{textOf(m.content)}</div>
            </div>
          );
        if (m.role === "assistant")
          return (
            <div key={i} class="msg msg-assistant">
              <div class="avatar">采</div>
              <div class="stack">
                <AssistantBubble m={m} live={live} />
                {!live && textOf(m.content) && (
                  <FeedbackBar messageId={id} sessionId={sessionId} current={feedback.get(id)} onChange={onFeedbackChange} onTeach={() => onTeach(id, feedback.get(id)?.note)} />
                )}
              </div>
            </div>
          );
        if (m.role === "toolResult")
          return (
            <div key={i} class={`msg msg-tool${m.isError ? " is-error" : ""}`}>
              <div class="stack">
                <div class="tool-result">
                  <span class="tool-tag">{m.isError ? "❌" : "✅"} {m.toolName}</span>
                  <div class="md" dangerouslySetInnerHTML={{ __html: renderMarkdown(textOf(m.content)) }} />
                </div>
                {!m.isError && ADOPTABLE.has(m.toolName) && (
                  <FeedbackBar messageId={id} sessionId={sessionId} current={feedback.get(id)} showAdopt onChange={onFeedbackChange} />
                )}
              </div>
            </div>
          );
        return null;
      })}
    </div>
  );
}
