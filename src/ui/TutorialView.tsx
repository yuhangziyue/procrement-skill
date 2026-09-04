// U8+ 采购图文教程 · 主区视图。
//
// 组织方式（2026-09-04 重做）：左侧目录不再按「查询/导出/导入/单据流」这种软件功能分组，
// 改按**采购闭环的七个阶段**（需求与算量 → 下单 → 回签 → 在途 → 到货 → 对账 + 系统通识）。
// 每组带一句「什么时候看这组」，让人一眼判断自己卡在哪。篇内显示 prereq / nextUp，
// 教程之间是一条路径，不是并列的孤岛。
//
// 素材源见 src/tutorial/content.ts 顶部注释：U8 菜单路径唯一来源是 u8-research.md，
// 每条按 ✅/⚠️/❌ 标了可信度，本页面原样透出，不升级、不抹掉。
// 界面里不出现 emoji，一律用 src/ui/icons.tsx 的 SVG（该文件只读引用，不改）。
//
// 固定签名（宿主 app.tsx 依赖）：TutorialView({ onAskAgent }) 。
import { useEffect, useMemo, useState } from "preact/hooks";
import type { JSX } from "preact";
import {
  CONFIDENCE_LABELS,
  OPEN_QUESTIONS,
  PITFALLS,
  SOURCES,
  STAGE_LABELS,
  TUTORIALS,
  groupByStage,
  groupSourcesByKind,
  resolveTutorials,
  searchSources,
  searchTutorials,
  type Confidence,
  type Source,
  type SourceKind,
  type Tutorial,
} from "../tutorial";
import { Icon, type IconName } from "./icons";
import "./TutorialView.css";

interface Props {
  onAskAgent?: (q: string) => void;
}

type Tab = "tutorials" | "pitfalls" | "sources" | "open";

const DONE_KEY = "xiaocai.tutorial.done";

const CONF_ICON: Record<Confidence, IconName> = { verified: "check", unverified: "warning", unknown: "alert" };
const CONF_TONE: Record<Confidence, "ok" | "warn" | "danger"> = {
  verified: "ok",
  unverified: "warn",
  unknown: "danger",
};

const SOURCE_KIND_ICON: Record<SourceKind, IconName> = {
  book: "book",
  standard: "file",
  course: "learning",
  video: "video",
  site: "link",
};

function ConfBadge({ c, text }: { c: Confidence; text?: boolean }) {
  return (
    <span class={`tut-badge tut-conf-${c}`} title={CONFIDENCE_LABELS[c]}>
      <Icon name={CONF_ICON[c]} size={13} tone={CONF_TONE[c]} />
      {text && <span>{CONFIDENCE_LABELS[c]}</span>}
    </span>
  );
}

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
  const groups = useMemo(() => groupByStage(filteredTutorials), [filteredTutorials]);

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

  const sourceGroups = useMemo(() => groupSourcesByKind(searchSources(query, SOURCES)), [query]);

  return (
    <div class="tut-view">
      <header class="tut-head">
        <div class="tut-tabs">
          <button class={`tut-tab${tab === "tutorials" ? " active" : ""}`} onClick={() => setTab("tutorials")}>
            <Icon name="tutorial" size={14} /> 教程目录 <span class="tut-tab-count">{TUTORIALS.length}</span>
          </button>
          <button class={`tut-tab${tab === "pitfalls" ? " active" : ""}`} onClick={() => setTab("pitfalls")}>
            <Icon name="warning" size={14} /> 常见坑速查 <span class="tut-tab-count">{PITFALLS.length}</span>
          </button>
          <button class={`tut-tab${tab === "sources" ? " active" : ""}`} onClick={() => setTab("sources")}>
            <Icon name="book" size={14} /> 权威信源 <span class="tut-tab-count">{SOURCES.length}</span>
          </button>
          <button class={`tut-tab${tab === "open" ? " active" : ""}`} onClick={() => setTab("open")}>
            <Icon name="alert" size={14} /> 待实机核对 <span class="tut-tab-count">{OPEN_QUESTIONS.length}</span>
          </button>
        </div>
        <input
          class="tut-search"
          type="search"
          placeholder="搜标题 / 步骤 / 坑 / 书名…"
          value={query}
          onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
        />
      </header>

      <div class="tut-legend">
        {(Object.keys(CONFIDENCE_LABELS) as Confidence[]).map((c) => (
          <span key={c} class={`tut-legend-item tut-conf-${c}`}>
            <Icon name={CONF_ICON[c]} size={13} tone={CONF_TONE[c]} />
            {CONFIDENCE_LABELS[c]}
          </span>
        ))}
      </div>

      {tab === "tutorials" && (
        <div class="tut-body">
          <nav class="tut-nav">
            <p class="tut-nav-intro">
              目录按<b>采购闭环的顺序</b>排：从「该下多少」一路到「月底怎么结」。不知道从哪看起就从第一组第一篇开始。
            </p>
            {groups.length === 0 && <p class="muted tut-nav-empty">没搜到相关教程。</p>}
            {groups.map((g, gi) => (
              <div key={g.stage} class="tut-nav-group">
                <div class="tut-nav-group-title">
                  <span class="tut-nav-group-n">{gi + 1}</span>
                  {g.label}
                </div>
                <div class="tut-nav-group-hint">{g.hint}</div>
                <ul class="tut-nav-list">
                  {g.items.map((t) => (
                    <li key={t.id}>
                      <button
                        class={`tut-nav-item${t.id === selectedId ? " active" : ""}`}
                        onClick={() => setSelectedId(t.id)}
                      >
                        <ConfBadge c={t.confidence} />
                        <span class="tut-nav-item-title">{t.title}</span>
                        <span class="tut-freq">{t.freq}</span>
                        {done.has(t.id) && (
                          <span class="tut-done-mark" title="已做完">
                            <Icon name="check" size={13} tone="ok" />
                          </span>
                        )}
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
              <div class="tut-pitfall-title">
                <Icon name="warning" size={15} tone="warn" />
                {p.title}
              </div>
              <p class="tut-pitfall-detail">{p.detail}</p>
              <p class="tut-pitfall-source">来源：{p.source}</p>
            </div>
          ))}
        </div>
      )}

      {tab === "sources" && (
        <div class="tut-flat">
          <p class="muted">
            采购这门手艺的权威学习资源，共 {SOURCES.length} 条。出版信息逐项查过：核到确切出处的标「已核实」，
            只在电商或二手来源见到的标「出版信息待核」——宁可标待核，也不编 ISBN。
          </p>
          {sourceGroups.length === 0 && <p class="muted">没搜到相关信源。</p>}
          {sourceGroups.map((g) => (
            <section key={g.kind} class="tut-src-group">
              <h3 class="tut-src-group-title">
                <Icon name={SOURCE_KIND_ICON[g.kind]} size={16} />
                {g.label}
                <span class="tut-tab-count">{g.items.length}</span>
              </h3>
              <div class="tut-src-list">
                {g.items.map((s) => (
                  <SourceCard key={s.id} source={s} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {tab === "open" && (
        <div class="tut-flat">
          <p class="muted">
            这些路径 / 细节没有可靠来源确认，共 {OPEN_QUESTIONS.length} 项。拍照核对时顺手把它们确认掉。
          </p>
          {filteredOpenQuestions.length === 0 && <p class="muted">没搜到相关条目。</p>}
          {filteredOpenQuestions.map((q) => (
            <div key={q.id} class="tut-oq-card">
              <div class="tut-oq-question">
                <Icon name="alert" size={15} tone="danger" />
                {q.question}
              </div>
              <p class="tut-oq-why">
                <b>为什么要核对：</b>
                {q.why}
              </p>
              <p class="tut-oq-how">
                <b>怎么核实：</b>
                {q.howToVerify}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SourceCard({ source: s }: { source: Source }) {
  const meta = [s.author, s.publisher, s.year ? `${s.year} 年` : null, s.isbn ? `ISBN ${s.isbn}` : null]
    .filter(Boolean)
    .join(" · ");
  return (
    <div class={`tut-src-card${s.confidence === "unverified" ? " unverified" : ""}`}>
      <div class="tut-src-head">
        <span class="tut-src-title">{s.title}</span>
        <span class="tut-tag">{s.level}</span>
        <span class="tut-tag">{s.lang === "zh" ? "中文" : "英文"}</span>
        {s.confidence === "verified" ? (
          <span class="tut-badge tut-conf-verified" title="书名/作者/出版社/年份/ISBN 或官方页面均已核到确切出处">
            <Icon name="check" size={13} tone="ok" />
            <span>已核实</span>
          </span>
        ) : (
          <span class="tut-badge tut-conf-unverified" title="确实存在，但没核到权威的出版信息，引用前请自行确认">
            <Icon name="warning" size={13} tone="warn" />
            <span>出版信息待核</span>
          </span>
        )}
      </div>
      {meta && <div class="tut-src-meta">{meta}</div>}
      <p class="tut-src-why">{s.why}</p>
      <div class="tut-src-foot">
        <span class="tut-src-covers">
          覆盖：{s.covers.join(" / ")}
        </span>
        {s.url && (
          <a class="tut-src-link" href={s.url} target="_blank" rel="noreferrer">
            <Icon name="external" size={13} />
            出处
          </a>
        )}
      </div>
    </div>
  );
}

function PathRow({
  icon,
  label,
  items,
  onJump,
}: {
  icon: IconName;
  label: string;
  items: Tutorial[];
  onJump: (id: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div class="tut-path-row">
      <span class="tut-path-label">
        <Icon name={icon} size={13} tone="muted" />
        {label}
      </span>
      {items.map((t) => (
        <button key={t.id} class="tut-path-btn" onClick={() => onJump(t.id)}>
          {t.title}
        </button>
      ))}
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
  const related = resolveTutorials(tutorial.related);
  const prereq = resolveTutorials(tutorial.prereq);
  const nextUp = resolveTutorials(tutorial.nextUp);

  return (
    <div class="tut-article-inner">
      <div class="tut-article-head">
        <h2>{tutorial.title}</h2>
        <div class="tut-article-tags">
          <ConfBadge c={tutorial.confidence} text />
          <span class="tut-tag tut-tag-stage">{STAGE_LABELS[tutorial.stage]}</span>
          <span class="tut-tag">{tutorial.freq}</span>
          <span class="tut-tag">
            <Icon name="clock" size={12} /> 约 {tutorial.minutes} 分钟
          </span>
        </div>
      </div>

      {(prereq.length > 0 || nextUp.length > 0) && (
        <div class="tut-path">
          <PathRow icon="chevronRight" label="先读：" items={prereq} onJump={onJump} />
          <PathRow icon="chevronDown" label="接着通常要：" items={nextUp} onJump={onJump} />
        </div>
      )}

      <p class="tut-scene">
        <b>你现在的处境：</b>
        {tutorial.scene}
      </p>
      <p class="tut-goal">
        <b>做完意味着：</b>
        {tutorial.goal}
      </p>

      <h3>操作步骤</h3>
      <ol class="tut-steps">
        {tutorial.steps.map((s) => (
          <li key={s.n} class="tut-step">
            <div class="tut-step-head">
              <span class="tut-step-n">{s.n}</span>
              <span class="tut-step-title">{s.title}</span>
              <ConfBadge c={s.confidence} />
            </div>
            {s.where && <code class="tut-step-where">{s.where}</code>}
            <p class="tut-step-detail">{s.detail}</p>
            {s.shot && (
              <div class="tut-shot-box">
                <Icon name="card" size={14} tone="muted" />
                <span>{s.shot}</span>
              </div>
            )}
            {s.pitfall && (
              <div class="tut-step-pitfall">
                <Icon name="warning" size={14} tone="warn" />
                <span>{s.pitfall}</span>
              </div>
            )}
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

      {(nextUp.length > 0 || related.length > 0) && (
        <>
          <h3>接下来</h3>
          <div class="tut-path tut-path-foot">
            <PathRow icon="chevronRight" label="接着做：" items={nextUp} onJump={onJump} />
            <PathRow icon="link" label="相关：" items={related} onJump={onJump} />
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
