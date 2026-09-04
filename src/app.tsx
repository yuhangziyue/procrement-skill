import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import type { Agent, AgentMessage } from "@earendil-works/pi-agent-core";
import { db, type EnhancementRow, type FeedbackRow, type SessionRow } from "./db/schema";
import { explainLlmError, getApiKey, getLlmSettings, needsProxy } from "./db/settings";
import { getFeedbackFor } from "./db/feedback";
import { findConflicts, saveEnhancement, type EnhancementDraft } from "./db/enhancements";
import { createAgent, sanitizeHistory } from "./agent/create-agent";
import { seedBuiltinCards } from "./knowledge/seed";
import { onEnhancementDraft } from "./tools/save-enhancement";
import { onCorrectionDraft } from "./tools/blindspot";
import { newId } from "./util/id";
import { SettingsPanel } from "./ui/SettingsPanel";
import { MaterialsPanel } from "./ui/MaterialsPanel";
import { ExportPanel } from "./ui/ExportPanel";
import { EnhancementsPanel } from "./ui/EnhancementsPanel";
import { EnhancementPreview } from "./ui/EnhancementPreview";
import { NavRail, type ViewId } from "./ui/NavRail";
import { ChatDock } from "./ui/ChatDock";
import { KnowledgePanel } from "./ui/KnowledgePanel";
import { isDesktop } from "./data/bridge";
import { loadBoard, rebuildBoard, setCheck, setTaskStatus, toggleStep, closeDay, type BoardSnapshot } from "./board/service";
import type { BoardTask } from "./board/types";
/* 集成开关：三个视图由工兵并行交付，到位一个打开一个（老架集成点，别在别处 import） */
import { BoardView } from "./ui/BoardView";
import { TutorialView } from "./ui/TutorialView";
import { LearningView } from "./ui/LearningView";

type Panel = "settings" | "materials" | "enhancements" | "export" | null;

export function App() {
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [currentId, setCurrentId] = useState<string>();
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [streaming, setStreaming] = useState<AgentMessage>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [panel, setPanel] = useState<Panel>(null);
  const [view, setView] = useState<ViewId>("board");
  const [board, setBoard] = useState<BoardSnapshot>();
  const [boardBusy, setBoardBusy] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
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

  const persist = async (sessionId: string, rawMsgs: AgentMessage[]) => {
    const msgs = sanitizeHistory(rawMsgs);
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
    // 「教它」与「纠错」两条路产出的草稿形状一致，走同一个预览确认（都不自动落库）
    const showDraft = async (d: EnhancementDraft & { sourceSessionId?: string }) => {
      const existing = await db.enhancements.toArray();
      setDraft({ draft: d, conflicts: findConflicts(d, existing), existing });
    };
    const offA = onEnhancementDraft(showDraft);
    const offB = onCorrectionDraft(showDraft);
    return () => { offA(); offB(); };
  }, []);

  // ---------- 工作看板 ----------
  const refreshBoard = useCallback(async () => {
    if (!isDesktop()) return;
    try { setBoard(await loadBoard()); } catch (e) { console.warn("load board failed", e); }
  }, []);

  const rebuildBoardNow = useCallback(async () => {
    setBoardBusy(true);
    try { setBoard(await rebuildBoard()); }
    catch (e: any) { setError(e?.message ?? String(e)); }
    finally { setBoardBusy(false); }
  }, []);

  useEffect(() => { void refreshBoard(); }, [refreshBoard]);

  // ⌘K / Ctrl+K 召出或收起采姐——浮窗化之后必须有键盘入口，否则比原来的常驻侧栏还难够到
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setChatOpen((v) => !v); }
      if (e.key === "Escape") setChatOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /** 卡片上的「问采姐」：把物料 / PO / 卡在哪一步一起带过去，她不用自己组织语言（苏姐 §3） */
  const askAboutTask = (task: BoardTask, question: string) => {
    const ctx = [
      task.materialCode && `物料 ${task.materialCode}${task.materialName ? `（${task.materialName}）` : ""}`,
      task.supplier && `供应商 ${task.supplier}`,
      task.poNo && `采购订单 ${task.poNo}`,
      task.needDate && `需求日期 ${task.needDate}`,
      task.dueDate && `最晚动作日 ${task.dueDate}`,
    ].filter(Boolean).join("、");
    setChatOpen(true);
    void send(`【来自工作台卡片：${task.title}】${ctx ? `背景：${ctx}。` : ""}${question}`);
  };

  const send = async (text: string) => {
    const agent = agentRef.current;
    if (!agent || !currentId) return;
    setBusy(true);
    setError(undefined);
    setMessages([...agent.state.messages, { role: "user", content: text, timestamp: Date.now() }]);
    try {
      await agent.prompt(text);
    } catch (e: any) {
      setError(explainLlmError(e?.message ?? String(e), await getLlmSettings()));
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

  /**
   * 点「不对 → 教它正确做法」走纠错三问，不再直接叫模型攒卡：
   * 走 record_correction 才会带上「来源：用户补充 · 日期」的戳，也才有"问不出正确答案就不落卡"的兜底。
   */
  const teach = (messageId: string, note?: string) => {
    const hint = note?.trim() ? `我先说一句：「${note.trim()}」。` : "";
    void send(
      `${hint}上面那条回复不对。请走纠错三问：一次只问一件事，最多三问——①哪一句不对（我可以跳过）` +
      `②正确的应该是什么 ③下次什么情况按这条办。拿到②之后调 record_correction 落成一张卡；` +
      `我要是说不清正确答案，就把 correct 留空调用，别自己编。`,
    );
  };

  const summarize = () => void send("请调用 save_summary（kind=manual）给本次会话做小结：事实 / 待办 / 新规矩。");

  const confirmDraft = async (edited: EnhancementDraft) => {
    if (!draft) return;
    await saveEnhancement({ ...edited, sourceSessionId: draft.draft.sourceSessionId });
    setDraft(undefined);
    await rebuild();
  };

  const current = sessions.find((s) => s.id === currentId);

  const boardEmpty = { items: [], canClose: false, handoverText: "" };

  /** 主区视图。三个视图由工兵并行交付，未到位的先给占位，不挡编译。 */
  const renderView = () => {
    switch (view) {
      case "board":
        return (
          <BoardView
            tasks={board?.ordered ?? []}
            top3={board?.top3 ?? []}
            groups={board?.groups ?? []}
            day={board?.day ?? boardEmpty}
            bizDate={board?.bizDate ?? new Date().toISOString().slice(0, 10)}
            loading={boardBusy}
            warnings={board?.warnings}
            desktopOnly={!isDesktop()}
            onToggleStep={(id, step, done) => void toggleStep(id, step, done, board?.tasks ?? []).then(refreshBoard)}
            onStatus={(id, st, note) => void setTaskStatus(id, st, note).then(refreshBoard)}
            onCheck={(item, checked) => void setCheck(board?.bizDate ?? "", item, checked).then(refreshBoard)}
            onCloseDay={() => void closeDay(board?.bizDate ?? "").then(refreshBoard)}
            onRefresh={() => void rebuildBoardNow()}
            onAskAgent={askAboutTask}
            onImport={() => setPanel("materials")}
          />
        );
      case "knowledge":
        return <KnowledgePanel onClose={() => setView("board")} />;
      case "tutorial":
        return <TutorialView onAskAgent={(q) => { setChatOpen(true); void send(q); }} />;
      case "learning":
        return <LearningView onAskAgent={(q) => { setChatOpen(true); void send(q); }} onOpenTutorial={() => setView("tutorial")} />;
    }
  };

  return (
    <div class="shell">
      <NavRail
        view={view}
        onChange={setView}
        onSettings={() => setPanel("settings")}
        alert={!hasKey}
      />

      <main class="shell-main">
        {proxyMissing && (
          <div class="banner warn">
            ⚠️ 当前选的是 Coding Plan 端点但没填代理地址——浏览器直连会被 CORS 拦住。去
            <button class="btn-link" onClick={() => setPanel("settings")}>设置</button>
            填代理地址，或切到「方舟标准端点」预设。
          </div>
        )}
        {error && <div class="banner error">⚠️ {error}</div>}
        {renderView()}
      </main>

      <ChatDock
        open={chatOpen}
        onOpen={() => setChatOpen(true)}
        onClose={() => setChatOpen(false)}
        sessions={sessions}
        currentId={currentId}
        title={current?.title}
        messages={messages}
        streaming={streaming}
        feedback={feedback}
        busy={busy}
        disabled={!hasKey || proxyMissing}
        hint={!hasKey ? "还没填 API Key——点右下角设置，或去「设置」页粘贴。" : undefined}
        onSend={send}
        onAbort={abort}
        onSelectSession={(id) => void selectSession(id)}
        onNewSession={() => void newSession()}
        onDeleteSession={(id) => void deleteSession(id)}
        onFeedbackChange={() => currentId && void refreshFeedback(currentId)}
        onTeach={teach}
        onSummarize={summarize}
        canSummarize={hasKey && !busy && messages.length >= 2}
        onOpenPanel={(p) => setPanel(p)}
      />

      <SettingsPanel open={panel === "settings"} onClose={() => setPanel(null)} onSaved={rebuild} />
      <MaterialsPanel open={panel === "materials"} onClose={() => setPanel(null)} onChanged={async () => { await rebuild(); await refreshBoard(); }} />
      <EnhancementsPanel open={panel === "enhancements"} onClose={() => setPanel(null)} onChanged={rebuild} />
      <ExportPanel open={panel === "export"} onClose={() => setPanel(null)} currentSessionId={currentId} onImported={async () => { await refreshSessions(); await rebuild(); }} />
      {draft && <EnhancementPreview draft={draft.draft} conflicts={draft.conflicts} existing={draft.existing} title="小采学到一条新规矩，确认后下次照办" onConfirm={confirmDraft} onCancel={() => setDraft(undefined)} />}
    </div>
  );
}
