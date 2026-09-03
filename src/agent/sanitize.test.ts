import { describe, expect, it } from "vitest";
import { sanitizeHistory } from "./create-agent";

const user = (t: string) => ({ role: "user", content: t, timestamp: 1 }) as any;
const asst = (content: any[], stopReason = "stop") => ({ role: "assistant", content, stopReason, api: "x", provider: "x", model: "x", usage: {}, timestamp: 1 }) as any;
const tr = (id: string) => ({ role: "toolResult", toolCallId: id, toolName: "t", content: [{ type: "text", text: "ok" }], isError: false, timestamp: 1 }) as any;

describe("sanitizeHistory", () => {
  it("剔除报错留下的空 assistant 与孤儿 toolResult", () => {
    const out = sanitizeHistory([user("a"), asst([], "error"), tr("dead"), user("b"), asst([{ type: "text", text: "好" }])]);
    expect(out.map((m: any) => m.role)).toEqual(["user", "user", "assistant"]);
  });
  it("保留正常的 toolCall → toolResult 链", () => {
    const out = sanitizeHistory([user("a"), asst([{ type: "toolCall", id: "c1", name: "t", arguments: {} }]), tr("c1"), asst([{ type: "text", text: "结果" }])]);
    expect(out.length).toBe(4);
  });
  it("只有 thinking 没有正文的 assistant 也剔除", () => {
    const out = sanitizeHistory([user("a"), asst([{ type: "thinking", thinking: "..." }], "aborted")]);
    expect(out.length).toBe(1);
  });
});
