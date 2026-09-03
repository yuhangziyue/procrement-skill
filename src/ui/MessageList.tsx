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

export function MessageList({ sessionId, messages, streaming, feedback, onFeedbackChange, onTeach }: Props) {
  const all = streaming ? [...messages, streaming] : messages;
  return (
    <div class="messages">
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
