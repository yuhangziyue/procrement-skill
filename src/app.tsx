import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import type { Agent, AgentMessage } from "@earendil-works/pi-agent-core";
import { db, type EnhancementRow, type FeedbackRow, type SessionRow } from "./db/schema";
import { explainLlmError, getApiKey, getLlmSettings, needsProxy } from "./db/settings";
import { getFeedbackFor } from "./db/feedback";
import { findConflicts, saveEnhancement, type EnhancementDraft } from "./db/enhancements";
import { createAgent } from "./agent/create-agent";
import { seedBuiltinCards } from "./knowledge/seed";
import { onEnhancementDraft } from "./tools/save-enhancement";
import { newId } from "./util/id";
import { Sidebar } from "./ui/Sidebar";
import { MessageList } from "./ui/MessageList";
import { Composer } from "./ui/Composer";
import { SettingsPanel } from "./ui/SettingsPanel";
import { MaterialsPanel } from "./ui/MaterialsPanel";
import { ExportPanel } from "./ui/ExportPanel";
import { EnhancementsPanel } from "./ui/EnhancementsPanel";
import { EnhancementPreview } from "./ui/EnhancementPreview";

type Panel = "settings" | "materials" | "enhancements" | "export" | null;

export function App() {
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [currentId, setCurrentId] = useState<string>();
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [streaming, setStreaming] = useState<AgentMessage>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [panel, setPanel] = useState<Panel>(null);
  const [hasKey, setHasKey] = useState(!!getApiKey());
  const [proxyMissing, setProxyMissing] = useState(false);
  const [feedback, setFeedback] = useState<Map<string, FeedbackRow>>(new Map());
  const [draft, setDraft] = useState<{ draft: EnhancementDraft & { sourceSessionId?: string }; conflicts: EnhancementRow[]; existing: EnhancementRow[] }>();
  const agentRef = useRef<Agent>();
  const unsubRef = useRef<() => void>();

  const refreshSessions = useCallback(async () => {
    const rows = await db.sessions.orderBy("updatedAt").reverse().toArray();
    setSessions(rows);
    return rows;
  }, []);

  const refreshProxyCheck = useCallback(async () => setProxyMissing(needsProxy(await getLlmSettings())), []);

  const refreshFeedback = useCallback(async (sessionId: string) => setFeedback(await getFeedbackFor(sessionId)), []);

  const persist = async (sessionId: string, msgs: AgentMessage[]) => {
    const now = Date.now();
    await db.transaction("rw", db.messages, db.sessions, async () => {
      await db.messages.where("sessionId").equals(sessionId).delete();
      await db.messages.bulkAdd(
        msgs.map((m, i) => ({ id: `${sessionId}:${i}`, sessionId, role: (m as any).role, content: m, createdAt: (m as any).timestamp ?? now + i })),
      );
      const first = msgs.find((m: any) => m.role === "user") as any;
      const title = first ? (typeof first.content === "string" ? first.content : first.content?.[0]?.text ?? "新会话").slice(0, 24) : "新会话";
      await db.sessions.update(sessionId, { updatedAt: now, title });
    });
    await refreshSessions();
  };

  /** 为某个会话（重）建 Agent：读库里的消息回灌，订阅事件驱动 UI。设置 / 增强卡 / 资料变化后也走这里。 */
  const mountAgent = useCallback(async (sessionId: string) => {
    unsubRef.current?.();
    const rows = await db.messages.where("sessionId").equals(sessionId).sortBy("createdAt");
    const history = rows.map((r) => r.content);
    const agent = await createAgent({ sessionId, messages: history });
    agentRef.current = agent;
    setMessages(history);
    setStreaming(undefined);
    setError(undefined);
    await refreshFeedback(sessionId);
    unsubRef.current = agent.subscribe(async (ev) => {
      if (ev.type === "message_start" || ev.type === "message_update") {
        if ((ev.message as any).role === "assistant") setStreaming(ev.message);
      }
      if (ev.type === "message_end" || ev.type === "turn_end") {
        setStreaming(undefined);
        setMessages([...agent.state.messages]);
      }
      if (ev.type === "agent_end") {
        setStreaming(undefined);
        setMessages([...agent.state.messages]);
        setBusy(false);
        if (agent.state.errorMessage) setError(explainLlmError(agent.state.errorMessage, await getLlmSettings()));
        await persist(sessionId, agent.state.messages);
      }
    });
  }, []);

  useEffect(() => {
    (async () => {
      await seedBuiltinCards(db).catch((e) => console.warn("seed builtin cards failed", e));
      let rows = await refreshSessions();
      if (rows.length === 0) {
        await db.sessions.add({ id: newId(), title: "新会话", createdAt: Date.now(), updatedAt: Date.now(), tags: [] });
        rows = await refreshSessions();
      }
      setCurrentId(rows[0].id);
      await mountAgent(rows[0].id);
      await refreshProxyCheck();
    })();
    // 「教它」草稿 → 预览确认
    return onEnhancementDraft(async (d) => {
      const existing = await db.enhancements.toArray();
      setDraft({ draft: d, conflicts: findConflicts(d, existing), existing });
    });
  }, []);

  const send = async (text: string) => {
    const agent = agentRef.current;
    if (!agent || !currentId) return;
    setBusy(true);
    setError(undefined);
    setMessages([...agent.state.messages, { role: "user", content: text, timestamp: Date.now() }]);
    try {
      await agent.prompt(text);
    } catch (e: any) {
      setError(e?.message ?? String(e));
      setBusy(false);
    }
  };

  const abort = () => agentRef.current?.abort();

  const newSession = async () => {
    const s: SessionRow = { id: newId(), title: "新会话", createdAt: Date.now(), updatedAt: Date.now(), tags: [] };
    await db.sessions.add(s);
    await refreshSessions();
    setCurrentId(s.id);
    await mountAgent(s.id);
  };

  const selectSession = async (id: string) => {
    if (id === currentId) return;
    setCurrentId(id);
    await mountAgent(id);
  };

  const deleteSession = async (id: string) => {
    if (!confirm("删除这个会话及其消息？（只影响这台浏览器）")) return;
    await db.transaction("rw", db.messages, db.sessions, db.feedback, db.summaries, async () => {
      await db.messages.where("sessionId").equals(id).delete();
      await db.feedback.where("sessionId").equals(id).delete();
      await db.summaries.where("sessionId").equals(id).delete();
      await db.sessions.delete(id);
    });
    const rows = await refreshSessions();
    if (id === currentId) {
      if (rows.length) {
        setCurrentId(rows[0].id);
        await mountAgent(rows[0].id);
      } else await newSession();
    }
  };

  /** 任何影响系统提示的变化（设置 / 增强卡 / 资料）→ 重建 Agent，历史消息原样带过去 */
  const rebuild = async () => {
    setHasKey(!!getApiKey());
    await refreshProxyCheck();
    if (currentId) await mountAgent(currentId);
  };

  const teach = (messageId: string, note?: string) => {
    const hint = note?.trim() ? `我对这条回复的备注：「${note.trim()}」。` : "";
    void send(`${hint}上面那条回复不对，请按我说的正确做法整理成一张增强卡（调用 save_enhancement），触发词要覆盖这个场景。`);
  };

  const summarize = () => void send("请调用 save_summary（kind=manual）给本次会话做小结：事实 / 待办 / 新规矩。");

  const confirmDraft = async (edited: EnhancementDraft) => {
    if (!draft) return;
    await saveEnhancement({ ...edited, sourceSessionId: draft.draft.sourceSessionId });
    setDraft(undefined);
    await rebuild();
  };

  const current = sessions.find((s) => s.id === currentId);

  return (
    <div class="layout">
      <Sidebar sessions={sessions} currentId={currentId} onSelect={selectSession} onNew={newSession} onDelete={deleteSession} />
      <main class="chat">
        <header class="topbar">
          <span class="title">{current?.title ?? ""}</span>
          <div class="topbar-actions">
            <button class="btn" onClick={summarize} disabled={!hasKey || busy || messages.length < 2} title="把本次会话做成留痕小结">📝 小结</button>
            <button class="btn" onClick={() => setPanel("materials")}>📂 资料库</button>
            <button class="btn" onClick={() => setPanel("enhancements")}>🧩 增强卡</button>
            <button class="btn" onClick={() => setPanel("export")}>⇩ 导出</button>
            <button class="btn" onClick={() => setPanel("settings")}>⚙ 设置{!hasKey && <span class="dot" />}</button>
          </div>
        </header>
        {proxyMissing && (
          <div class="banner warn">
            ⚠️ 当前选的是 Coding Plan 端点但没填代理地址——浏览器直连会被 CORS 拦住。去
            <button class="btn-link" onClick={() => setPanel("settings")}>设置</button>
            填代理地址，或切到「方舟标准端点」预设。
          </div>
        )}
        {error && <div class="banner error">⚠️ {error}</div>}
        {currentId && (
          <MessageList sessionId={currentId} messages={messages} streaming={streaming} feedback={feedback} onFeedbackChange={() => currentId && refreshFeedback(currentId)} onTeach={teach} />
        )}
        <Composer disabled={!hasKey || proxyMissing} streaming={busy} onSend={send} onAbort={abort} />
      </main>
      <SettingsPanel open={panel === "settings"} onClose={() => setPanel(null)} onSaved={rebuild} />
      <MaterialsPanel open={panel === "materials"} onClose={() => setPanel(null)} onChanged={rebuild} />
      <EnhancementsPanel open={panel === "enhancements"} onClose={() => setPanel(null)} onChanged={rebuild} />
      <ExportPanel open={panel === "export"} onClose={() => setPanel(null)} currentSessionId={currentId} onImported={async () => { await refreshSessions(); await rebuild(); }} />
      {draft && <EnhancementPreview draft={draft.draft} conflicts={draft.conflicts} existing={draft.existing} title="小采学到一条新规矩，确认后下次照办" onConfirm={confirmDraft} onCancel={() => setDraft(undefined)} />}
    </div>
  );
}
