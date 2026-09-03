// U8+ 采购图文教程 · 主区视图（工兵 E3 交付）。
//
// 素材源见 src/tutorial/content.ts 顶部注释：唯一来源是 u8-research.md，
// 每条菜单路径/结论按 ✅/⚠️/❌ 标了可信度，本页面原样透出，不升级、不抹掉。
//
// 固定签名（宿主 app.tsx 依赖）：TutorialView({ onAskAgent }) 。
import { useEffect, useMemo, useState } from "preact/hooks";
import type { JSX } from "preact";
import {
  CATEGORY_LABELS,
  CONFIDENCE_LABELS,
  OPEN_QUESTIONS,
  PITFALLS,
  TUTORIALS,
  groupByCategory,
  searchTutorials,
  type Confidence,
  type Tutorial,
} from "../tutorial";
import "./TutorialView.css";

interface Props {
  onAskAgent?: (q: string) => void;
}

type Tab = "tutorials" | "pitfalls" | "open";

const DONE_KEY = "xiaocai.tutorial.done";
const CONFIDENCE_BADGE: Record<Confidence, string> = { verified: "✅", unverified: "⚠️", unknown: "❌" };

function loadDone(): Set<string> {
  try {
    const raw = localStorage.getItem(DONE_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function saveDone(ids: Set<string>) {
  try {
    localStorage.setItem(DONE_KEY, JSON.stringify([...ids]));
  } catch {
    // 存不进去（隐私模式等）就算了，不影响本次使用
  }
}

export function TutorialView({ onAskAgent }: Props): JSX.Element {
  const [tab, setTab] = useState<Tab>("tutorials");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string>(TUTORIALS[0]?.id ?? "");
  const [done, setDone] = useState<Set<string>>(() => loadDone());

  const filteredTutorials = useMemo(() => searchTutorials(query, TUTORIALS), [query]);
  const groups = useMemo(() => groupByCategory(filteredTutorials), [filteredTutorials]);

  // 搜索结果里没有当前选中的这篇了，就自动跳到搜索结果第一篇，避免右边显示一篇左边看不到的教程
  useEffect(() => {
    if (filteredTutorials.some((t) => t.id === selectedId)) return;
    if (filteredTutorials[0]) setSelectedId(filteredTutorials[0].id);
  }, [filteredTutorials, selectedId]);

  const selected = TUTORIALS.find((t) => t.id === selectedId);

  const toggleDone = (id: string) => {
    setDone((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      saveDone(next);
      return next;
    });
  };

  const ask = (t: Tutorial, extra?: string) =>
    onAskAgent?.(`我在看教程《${t.title}》，${extra ?? "有个地方没看懂，能帮我讲讲吗？"}`);

  const filteredPitfalls = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return PITFALLS;
    return PITFALLS.filter((p) => (p.title + p.detail).toLowerCase().includes(q));
  }, [query]);

  const filteredOpenQuestions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return OPEN_QUESTIONS;
    return OPEN_QUESTIONS.filter((o) => (o.question + o.why + o.howToVerify).toLowerCase().includes(q));
  }, [query]);

  return (
    <div class="tut-view">
      <header class="tut-head">
        <div class="tut-tabs">
          <button class={`tut-tab${tab === "tutorials" ? " active" : ""}`} onClick={() => setTab("tutorials")}>
            教程目录
          </button>
          <button class={`tut-tab${tab === "pitfalls" ? " active" : ""}`} onClick={() => setTab("pitfalls")}>
            常见坑速查 <span class="tut-tab-count">{PITFALLS.length}</span>
          </button>
          <button class={`tut-tab${tab === "open" ? " active" : ""}`} onClick={() => setTab("open")}>
            待实机核对清单 <span class="tut-tab-count">{OPEN_QUESTIONS.length}</span>
          </button>
        </div>
        <input
          class="tut-search"
          type="search"
          placeholder="搜标题 / 步骤 / 坑…"
          value={query}
          onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
        />
      </header>

      <div class="tut-legend">
        {(Object.keys(CONFIDENCE_LABELS) as Confidence[]).map((c) => (
          <span key={c} class={`tut-legend-item tut-conf-${c}`}>
            {CONFIDENCE_LABELS[c]}
          </span>
        ))}
      </div>

      {tab === "tutorials" && (
        <div class="tut-body">
          <nav class="tut-nav">
            {groups.length === 0 && <p class="muted tut-nav-empty">没搜到相关教程。</p>}
            {groups.map((g) => (
              <div key={g.category} class="tut-nav-group">
                <div class="tut-nav-group-title">{g.label}</div>
                <ul class="tut-nav-list">
                  {g.items.map((t) => (
                    <li key={t.id}>
                      <button
                        class={`tut-nav-item${t.id === selectedId ? " active" : ""}`}
                        onClick={() => setSelectedId(t.id)}
                      >
                        <span class={`tut-badge tut-conf-${t.confidence}`} title={CONFIDENCE_LABELS[t.confidence]}>
                          {CONFIDENCE_BADGE[t.confidence]}
                        </span>
                        <span class="tut-nav-item-title">{t.title}</span>
                        <span class="tut-freq">{t.freq}</span>
                        {done.has(t.id) && <span class="tut-done-mark" title="已做完">✓</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>

          <article class="tut-article">
            {!selected && <p class="muted">左边选一篇教程开始看。</p>}
            {selected && (
              <TutorialArticle
                key={selected.id}
                tutorial={selected}
                done={done.has(selected.id)}
                onToggleDone={() => toggleDone(selected.id)}
                onAsk={(extra) => ask(selected, extra)}
                onJump={(id) => setSelectedId(id)}
              />
            )}
          </article>
        </div>
      )}

      {tab === "pitfalls" && (
        <div class="tut-flat">
          <p class="muted">
            用友 U8+ 采购模块的高频坑，来自 u8-research.md §7.2「常见坑总表」，共 {PITFALLS.length} 条，一条不落。
          </p>
          {filteredPitfalls.length === 0 && <p class="muted">没搜到相关的坑。</p>}
          {filteredPitfalls.map((p) => (
            <div key={p.id} class="tut-pitfall-card">
              <div class="tut-pitfall-title">⚠️ {p.title}</div>
              <p class="tut-pitfall-detail">{p.detail}</p>
              <p class="tut-pitfall-source">来源：{p.source}</p>
            </div>
          ))}
        </div>
      )}

      {tab === "open" && (
        <div class="tut-flat">
          <p class="muted">
            这些路径 / 细节没有可靠来源确认，标了 ❌ 或存疑，共 {OPEN_QUESTIONS.length} 项。拍照核对时顺手把它们确认掉。
          </p>
          {filteredOpenQuestions.length === 0 && <p class="muted">没搜到相关条目。</p>}
          {filteredOpenQuestions.map((q) => (
            <div key={q.id} class="tut-oq-card">
              <div class="tut-oq-question">❌ {q.question}</div>
              <p class="tut-oq-why"><b>为什么要核对：</b>{q.why}</p>
              <p class="tut-oq-how"><b>怎么核实：</b>{q.howToVerify}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TutorialArticle({
  tutorial,
  done,
  onToggleDone,
  onAsk,
  onJump,
}: {
  tutorial: Tutorial;
  done: boolean;
  onToggleDone: () => void;
  onAsk: (extra?: string) => void;
  onJump: (id: string) => void;
}) {
  const related = (tutorial.related ?? [])
    .map((id) => TUTORIALS.find((t) => t.id === id))
    .filter((t): t is Tutorial => !!t);

  return (
    <div class="tut-article-inner">
      <div class="tut-article-head">
        <h2>{tutorial.title}</h2>
        <div class="tut-article-tags">
          <span class={`tut-badge tut-conf-${tutorial.confidence}`}>{CONFIDENCE_LABELS[tutorial.confidence]}</span>
          <span class="tut-tag">{CATEGORY_LABELS[tutorial.category]}</span>
          <span class="tut-tag">{tutorial.freq}</span>
          <span class="tut-tag">约 {tutorial.minutes} 分钟</span>
        </div>
      </div>

      <p class="tut-goal"><b>目标：</b>{tutorial.goal}</p>
      <p class="tut-scene"><b>场景：</b>{tutorial.scene}</p>

      <h3>操作步骤</h3>
      <ol class="tut-steps">
        {tutorial.steps.map((s) => (
          <li key={s.n} class="tut-step">
            <div class="tut-step-head">
              <span class="tut-step-n">{s.n}</span>
              <span class="tut-step-title">{s.title}</span>
              <span class={`tut-badge tut-conf-${s.confidence}`} title={CONFIDENCE_LABELS[s.confidence]}>
                {CONFIDENCE_BADGE[s.confidence]}
              </span>
            </div>
            {s.where && <code class="tut-step-where">{s.where}</code>}
            <p class="tut-step-detail">{s.detail}</p>
            {s.shot && <div class="tut-shot-box">📷 {s.shot}</div>}
            {s.pitfall && <div class="tut-step-pitfall">⚠️ {s.pitfall}</div>}
          </li>
        ))}
      </ol>

      <h3>做完检查一下</h3>
      <ul class="tut-checkpoints">
        {tutorial.checkpoints.map((c, i) => (
          <li key={i}>{c}</li>
        ))}
      </ul>

      {tutorial.troubleshooting.length > 0 && (
        <>
          <h3>常见问题</h3>
          <div class="tut-trouble-list">
            {tutorial.troubleshooting.map((item, i) => (
              <div key={i} class="tut-trouble-card">
                <div class="tut-trouble-symptom">现象：{item.symptom}</div>
                <div class="tut-trouble-cause">原因：{item.cause}</div>
                <div class="tut-trouble-fix">处理：{item.fix}</div>
              </div>
            ))}
          </div>
        </>
      )}

      {related.length > 0 && (
        <>
          <h3>相关教程</h3>
          <div class="tut-related">
            {related.map((r) => (
              <button key={r.id} class="btn tut-related-btn" onClick={() => onJump(r.id)}>
                {r.title}
              </button>
            ))}
          </div>
        </>
      )}

      <footer class="tut-article-footer">
        <label class="tut-done-toggle">
          <input type="checkbox" checked={done} onChange={onToggleDone} />
          按这篇做完了
        </label>
        <button class="btn btn-primary" onClick={() => onAsk()}>
          问采姐
        </button>
      </footer>
    </div>
  );
}
