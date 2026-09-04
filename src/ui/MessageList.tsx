import { useLayoutEffect, useRef } from "preact/hooks";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { FeedbackRow } from "../db/schema";
import { renderMarkdown } from "../util/markdown";
import { explainLlmError } from "../db/settings";
import { FeedbackBar } from "./FeedbackBar";
import { Icon } from "./icons";

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

const ADOPTABLE = new Set(["calc_order_qty", "backward_schedule", "check_po", "arrival_notice", "track_status"]);

/** 离底部多少像素以内算「贴着底」；用户往上翻超过这个距离，流式更新就不再抢滚动条 */
const STICK_THRESHOLD = 48;

interface Step {
  m: any;
  idx: number;
}

/**
 * 一轮 = 一条用户消息 + 之后到下一条用户消息之前的全部产出。
 * 最后一条 assistant 是「答案」；其余（模型推理块 / 工具调用 / 工具结果 / 中间过渡文字）都算「思考过程」，默认折叠。
 */
interface Turn {
  key: number;
  user?: Step;
  process: Step[];
  final?: Step;
}

function groupTurns(all: any[]): Turn[] {
  const turns: Turn[] = [];
  let cur: Turn = { key: -1, process: [] };
  const flush = () => {
    if (cur.user || cur.process.length) turns.push(cur);
  };
  all.forEach((m, idx) => {
    if (m.role === "user") {
      flush();
      cur = { key: idx, user: { m, idx }, process: [] };
      return;
    }
    cur.process.push({ m, idx });
  });
  flush();
  for (const t of turns) {
    const last = t.process[t.process.length - 1];
    if (last?.m.role === "assistant") {
      t.final = last;
      t.process = t.process.slice(0, -1);
    }
  }
  return turns;
}

function ToolCallCard({ b }: { b: any }) {
  return (
    <div class="tool-call">
      <span class="tool-tag"><Icon name="external" size={13} tone="muted" /> {b.name}</span>
      <pre>{JSON.stringify(b.arguments, null, 2)}</pre>
    </div>
  );
}

function ThinkingText({ text }: { text: string }) {
  return <div class="thinking-text">{text}</div>;
}

/** 思考过程里的一条 assistant 消息：推理块 + 过渡文字 + 工具调用，全部平铺 */
function ProcessAssistant({ m }: { m: any }) {
  const blocks = (m.content ?? []) as any[];
  return (
    <>
      {blocks.map((b, i) => {
        if (b.type === "thinking" && b.thinking) return <ThinkingText key={i} text={b.thinking} />;
        if (b.type === "text" && b.text) return <div key={i} class="md process-text" dangerouslySetInnerHTML={{ __html: renderMarkdown(b.text) }} />;
        if (b.type === "toolCall") return <ToolCallCard key={i} b={b} />;
        return null;
      })}
    </>
  );
}

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

  const turns = groupTurns(all);
  const lastIdx = all.length - 1;

  return (
    <div class="messages" ref={listRef} onScroll={onScroll} onWheel={onWheel} onTouchMove={onTouchMove}>
      {all.length === 0 && (
        <div class="empty">
          <h2>你好，我是小采。</h2>
          <p>采购新人的 AI 师姐——下单前先算账、到货前发预告、逾期了怎么催，都可以问我。</p>
          <p class="hint">试试：「腰封 A 生产表要 3000 只，可用库存 800，在途 500，MOQ 2000，该下多少？」</p>
        </div>
      )}
      {turns.map((t) => {
        const final = t.final;
        const finalBlocks = (final?.m.content ?? []) as any[];
        const finalLive = !!streaming && final?.idx === lastIdx;
        const finalText = final ? textOf(final.m.content) : "";
        // 答案自己的推理块 / 工具调用也算思考过程
        const finalProcessBlocks = finalBlocks.filter((b) => (b.type === "thinking" && b.thinking) || b.type === "toolCall");
        const stepCount = t.process.filter((s) => s.m.role === "toolResult").length + finalProcessBlocks.filter((b) => b.type === "toolCall").length;
        const hasThinking = t.process.some((s) => s.m.role === "assistant" && (s.m.content ?? []).some((b: any) => b.type === "thinking" && b.thinking)) || finalProcessBlocks.some((b) => b.type === "thinking");
        const hasProcess = t.process.length > 0 || finalProcessBlocks.length > 0;
        // 还在流式、答案正文一个字没出来 ⇒ 标题显示「思考中…」
        const thinkingNow = !!streaming && !finalText && (final?.idx === lastIdx || t.process.some((s) => s.idx === lastIdx));
        const summaryLabel = thinkingNow ? "思考中…" : `思考过程${stepCount ? ` · ${stepCount} 步工具` : ""}${hasThinking ? " · 含推理" : ""}`;

        return (
          <div key={t.key} class="turn">
            {t.user && (
              <div class="msg msg-user">
                <div class="bubble">{textOf(t.user.m.content)}</div>
              </div>
            )}
            {(hasProcess || thinkingNow) && (
              <details class={`thinking${thinkingNow ? " live" : ""}`}>
                <summary>
                  <span class="thinking-icon"><Icon name="brain" size={14} /></span> {summaryLabel}
                  {thinkingNow && <span class="cursor">▍</span>}
                  <span class="thinking-hint">点击{"展开 / 收起"}</span>
                </summary>
                <div class="thinking-body">
                  {t.process.map((s) => {
                    const id = messageId(sessionId, s.idx);
                    if (s.m.role === "assistant") return <ProcessAssistant key={s.idx} m={s.m} />;
                    if (s.m.role === "toolResult")
                      return (
                        <div key={s.idx} class={`process-tool${s.m.isError ? " is-error" : ""}`}>
                          <div class="tool-result">
                            <span class="tool-tag">
                              <Icon name={s.m.isError ? "alert" : "done"} size={13} tone={s.m.isError ? "danger" : "ok"} /> {s.m.toolName}
                            </span>
                            <div class="md" dangerouslySetInnerHTML={{ __html: renderMarkdown(textOf(s.m.content)) }} />
                          </div>
                          {!s.m.isError && ADOPTABLE.has(s.m.toolName) && (
                            <FeedbackBar messageId={id} sessionId={sessionId} current={feedback.get(id)} showAdopt onChange={onFeedbackChange} />
                          )}
                        </div>
                      );
                    return null;
                  })}
                  {finalProcessBlocks.map((b, i) =>
                    b.type === "thinking" ? <ThinkingText key={`f${i}`} text={b.thinking} /> : <ToolCallCard key={`f${i}`} b={b} />,
                  )}
                </div>
              </details>
            )}
            {/* 答案正文一个字没出来之前不出空气泡——那阵子由折叠块的「思考中…」当指示器 */}
            {final && (finalText || final.m.stopReason === "error") && (
              <div class="msg msg-assistant">
                <div class="avatar">采</div>
                <div class="stack">
                  <div class="bubble">
                    {finalBlocks.map((b, i) =>
                      b.type === "text" && b.text ? <div key={i} class="md" dangerouslySetInnerHTML={{ __html: renderMarkdown(b.text) }} /> : null,
                    )}
                    {final.m.stopReason === "error" && (
                      <div class="error"><Icon name="alert" size={14} tone="danger" /> {explainLlmError(final.m.errorMessage || "请求失败")}</div>
                    )}
                    {finalLive && <span class="cursor">▍</span>}
                  </div>
                  {!finalLive && finalText && (
                    <FeedbackBar
                      messageId={messageId(sessionId, final.idx)}
                      sessionId={sessionId}
                      current={feedback.get(messageId(sessionId, final.idx))}
                      onChange={onFeedbackChange}
                      onTeach={() => onTeach(messageId(sessionId, final.idx), feedback.get(messageId(sessionId, final.idx))?.note)}
                    />
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
