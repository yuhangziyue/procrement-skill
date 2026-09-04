import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { format } from "date-fns";
import { isDesktop } from "../data/bridge";
import type { DocAppraisal } from "../knowledge/appraise";
import { CATEGORIES, categoryName } from "../knowledge/classify";
import { CONFIDENCE_LABEL, fallbackFor, type FallbackNote } from "../knowledge/fallback";
import { findGaps, gapSummary } from "../knowledge/gaps";
import { emptyGraph, type KnowledgeGraph, type TopicCoverage } from "../knowledge/graph";
import { SUPPORTED_EXTS, ingestFile } from "../knowledge/ingest";
import {
  listDocs,
  loadKnowledgeGraph,
  removeDoc,
  searchKnowledgeBase,
  splitHighlight,
  type KbDoc,
  type KbHit,
  type TopicLink,
} from "../knowledge/kb";
import { MODULES, moduleProgress, type KnowledgeModule } from "../knowledge/modules";
import { relationsOf, topicById, type TopicSpec } from "../knowledge/taxonomy";
import { SOURCES } from "../tutorial/sources";
import { TUTORIALS } from "../tutorial/content";
import { Icon, type IconName } from "./icons";
import "./KnowledgePanel.css";

// 结构与 class 命名跟着 MaterialsPanel 走（drawer / btn / muted 来自 styles.css），只加 .kb-* 前缀类。
// 三个视图：体系（六个模块 → 模块详情）/ 文档（导入 + 已入库 + 评价）/ 搜索（检索 + 顺着查）。
// 图标一律走 ui/icons 的 SVG，界面里不出现 emoji。
//
// 体系视图的核心取舍（DESIGN-workbench-v2.md §5）：首屏只给六张模块卡，一个主题名都不出现——
// 卡片第三行只取 worstGap.why（后果原文），不带 worstGap.name，这是唯一能让「不出现任何
// TopicSpec.name」这条可程序判定的验收成立的写法。主题名只在点进某个模块之后才出现。

const ACCEPT = SUPPORTED_EXTS.map((e) => `.${e}`).join(",");
const DEBOUNCE_MS = 250;

type Tab = "system" | "docs" | "search";
const TABS: { id: Tab; label: string; icon: IconName }[] = [
  { id: "system", label: "体系", icon: "knowledge" },
  { id: "docs", label: "文档", icon: "folder" },
  { id: "search", label: "搜索", icon: "search" },
];

interface ImportItem {
  name: string;
  state: "wait" | "doing" | "ok" | "fail";
  /** 成功=「分类 · N 块」，失败=中文原因 */
  message: string;
  warnings: string[];
}

/** 已入库文档除了 kb.ts 里那份基础形状，主进程 kb.listDocs 还会带上评价（老记录为 null）。
 *  appraise.ts 是导入时顺手算好存进 SQLite 的，kb.ts 的 KbDoc 类型是只读文件不让改，
 *  这里就地扩展一份类型，不动 kb.ts 本身。 */
type KbDocX = KbDoc & { appraisal?: DocAppraisal | null };

const SOURCE_TITLE = new Map(SOURCES.map((s) => [s.id, s.title]));
const TUTORIAL_TITLE = new Map(TUTORIALS.map((t) => [t.id, t.title]));

const truncate = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    /* 剪贴板不可用就算了，不阻断操作 */
  }
}

/** 主题状态 → 图标与语气，三态：✅ 齐（命中 ≥ minChunks）/ 🟡 弱（命中但不足）/ ⚠️ 缺（一段都没有） */
function topicMark(cov: TopicCoverage): { icon: IconName; tone: "ok" | "warn" | "danger" | "muted"; label: string } {
  if (cov.satisfied) return { icon: "check", tone: "ok", label: "已覆盖" };
  if (cov.hits > 0) return { icon: "alert", tone: "warn", label: "弱" };
  if (cov.topic.required) return { icon: "warning", tone: "danger", label: "必备缺失" };
  return { icon: "gap", tone: "muted", label: "建议补充" };
}

export function KnowledgePanel({ onClose, mode = "page" }: { onClose: () => void; mode?: "page" | "drawer" }) {
  const supported = isDesktop();
  const [tab, setTab] = useState<Tab>("system");
  const [activeModule, setActiveModule] = useState<string | null>(null);
  const [docs, setDocs] = useState<KbDocX[]>([]);
  const [graph, setGraph] = useState<KnowledgeGraph>(() => emptyGraph());
  const [graphLoading, setGraphLoading] = useState(false);
  const [openTopics, setOpenTopics] = useState<Set<string>>(new Set());
  const [openDocs, setOpenDocs] = useState<Set<string>>(new Set());
  const [focusChunk, setFocusChunk] = useState<string>();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<string>("all");
  const [hits, setHits] = useState<KbHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [imports, setImports] = useState<ImportItem[]>([]);
  const [importing, setImporting] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string>();
  const fileRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  const refresh = async () => {
    try {
      setDocs((await listDocs()) as KbDocX[]);
    } catch (err: any) {
      setError(`读知识库失败：${err?.message ?? String(err)}`);
    }
    if (!supported) return;
    setGraphLoading(true);
    try {
      setGraph(await loadKnowledgeGraph());
    } catch (err: any) {
      setError(`盘点知识体系失败：${err?.message ?? String(err)}`);
    } finally {
      setGraphLoading(false);
    }
  };

  useEffect(() => {
    if (supported) refresh();
  }, []);

  // 输入即搜，防抖 250ms；查询清空时立刻收起结果
  useEffect(() => {
    if (!supported) return;
    const q = query.trim();
    if (!q) {
      setHits([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    let alive = true;
    const timer = setTimeout(async () => {
      try {
        const r = await searchKnowledgeBase(q, { limit: 8, category: filter });
        if (alive) setHits(r);
      } catch (err: any) {
        if (alive) setError(`检索失败：${err?.message ?? String(err)}`);
      } finally {
        if (alive) setSearching(false);
      }
    }, DEBOUNCE_MS);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [query, filter, supported]);

  // 从体系视图点某一段跳过来时，把那条结果滚到视野里并高亮
  useEffect(() => {
    if (!focusChunk || searching) return;
    const el = bodyRef.current?.querySelector(`[data-chunk="${focusChunk}"]`);
    el?.scrollIntoView({ block: "center" });
  }, [focusChunk, hits, searching]);

  const runImport = async (files: File[]) => {
    if (!files.length) return;
    setError(undefined);
    setImporting(true);
    setImports(files.map((f) => ({ name: f.name, state: "wait", message: "排队中", warnings: [] })));
    for (let i = 0; i < files.length; i++) {
      const patch = (item: Partial<ImportItem>) =>
        setImports((prev) => prev.map((it, k) => (k === i ? { ...it, ...item } : it)));
      patch({ state: "doing", message: "解析中…" });
      try {
        const r = await ingestFile(files[i]);
        patch({
          state: "ok",
          message: `${categoryName(r.category)} · ${r.chunks} 块 · ${r.charCount} 字`,
          warnings: r.warnings,
        });
      } catch (err: any) {
        patch({ state: "fail", message: err?.message ?? String(err), warnings: [] });
      }
    }
    setImporting(false);
    await refresh();
  };

  const onPick = async (e: Event) => {
    const input = e.target as HTMLInputElement;
    const files = [...(input.files ?? [])];
    input.value = "";
    await runImport(files);
  };

  const onDrop = async (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    await runImport([...(e.dataTransfer?.files ?? [])]);
  };

  const doDelete = async (d: KbDoc) => {
    if (!confirm(`把「${d.title}」从知识库里删掉？（连同它的 ${d.chunkCount} 个知识块）`)) return;
    try {
      await removeDoc(d.id);
      setHits((prev) => prev.filter((h) => h.docId !== d.id));
      await refresh();
    } catch (err: any) {
      setError(`删除失败：${err?.message ?? String(err)}`);
    }
  };

  const toggleTopic = (id: string) =>
    setOpenTopics((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const toggleDoc = (id: string) =>
    setOpenDocs((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  /** 体系视图 → 搜索视图：用主题的头号关键词把那一段捞出来，滚到它 */
  const jumpToChunk = (topic: TopicSpec, chunkId: string) => {
    setFilter("all");
    setQuery(topic.satisfiedBy.keywords[0] ?? topic.name);
    setFocusChunk(chunkId);
    setTab("search");
  };

  /** 顺着关联查：点一个主题标签就展开它。跳的目标可能不在当前打开的模块里，
   *  所以顺手把 activeModule 切到它所在的模块，再展开、滚过去。 */
  const gotoTopic = (topicId: string) => {
    setTab("system");
    const owner = MODULES.find((m) => m.topicIds.includes(topicId));
    if (owner) setActiveModule(owner.id);
    setOpenTopics((prev) => new Set(prev).add(topicId));
    requestAnimationFrame(() => {
      bodyRef.current?.querySelector(`[data-topic="${topicId}"]`)?.scrollIntoView({ block: "center" });
    });
  };

  /** 首屏搜索框：不用先选模块，直接绕过模块跳到搜索 tab 定位主题/术语/文件名 */
  const quickJump = (v: string) => {
    setQuery(v);
    if (v.trim()) setTab("search");
  };

  const summary = useMemo(() => gapSummary(graph), [graph]);
  const gapCount = useMemo(() => findGaps(graph).length, [graph]);
  const shown = filter === "all" ? docs : docs.filter((d) => d.category === filter);
  // 标签条只显示实际有文档的分类，免得一排空标签
  const used = new Set(docs.map((d) => d.category));
  const requiredPct = summary.requiredTotal ? 100 / summary.requiredTotal : 0;
  const coveredPct = summary.covered * requiredPct;
  const fallbackPct = summary.fallbackOnly * requiredPct;
  const barePct = summary.bare * requiredPct;

  const FallbackBlock = ({ fb }: { fb: FallbackNote }) => {
    const [open, setOpen] = useState(fb.confidence === "needs-company");
    const tutorialIds = fb.tutorialIds ?? [];
    return (
      <div class="kb-fallback">
        <button class="kb-fallback-toggle" onClick={() => setOpen((o) => !o)}>
          <Icon name="book" size={13} />
          <span>通用口径 · 可先看</span>
          <span class="kb-badge kb-badge-conf">{CONFIDENCE_LABEL[fb.confidence]}</span>
          <Icon name={open ? "chevronDown" : "chevronRight"} tone="muted" size={13} />
        </button>
        {open && (
          <div class="kb-fallback-body">
            <p class="kb-fallback-summary">{fb.summary}</p>
            <ul class="kb-fallback-points">
              {fb.keyPoints.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ul>
            {fb.pitfalls && fb.pitfalls.length > 0 && (
              <div class="kb-fallback-pitfalls">
                <strong>常踩</strong>
                <ul>
                  {fb.pitfalls.map((p, i) => (
                    <li key={i}>{p}</li>
                  ))}
                </ul>
              </div>
            )}
            <div class="kb-fallback-varies">
              <strong>这部分各家不同</strong>
              <p>{fb.companyVaries}</p>
            </div>
            {(fb.sourceIds.length > 0 || tutorialIds.length > 0) && (
              <div class="kb-fallback-links">
                {fb.sourceIds.map((id) => (
                  <span key={id} class="kb-chip kb-chip-ghost">
                    <Icon name="book" size={11} />
                    {SOURCE_TITLE.get(id) ?? id}
                  </span>
                ))}
                {tutorialIds.map((id) => (
                  <span key={id} class="kb-chip kb-chip-ghost">
                    <Icon name="video" size={11} />
                    {TUTORIAL_TITLE.get(id) ?? id}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  const TopicRow = ({ cov }: { cov: TopicCoverage }) => {
    const mark = topicMark(cov);
    const open = openTopics.has(cov.topic.id);
    const rels = relationsOf(cov.topic.id);
    const contrasts = rels.filter((r) => r.kind === "contrast");
    const others = rels.filter((r) => r.kind !== "contrast");
    const fb = !cov.satisfied ? fallbackFor(cov.topic.id) : undefined;
    return (
      <li class={`kb-topic kb-topic-${mark.tone}${open ? " open" : ""}`} data-topic={cov.topic.id}>
        <button class="kb-topic-head" onClick={() => toggleTopic(cov.topic.id)} title={mark.label}>
          <Icon name={mark.icon} tone={mark.tone} size={15} />
          <span class="kb-topic-name">{cov.topic.name}</span>
          {cov.topic.required && !cov.satisfied && <span class="kb-badge kb-badge-must">必备</span>}
          {cov.hits > 0 && <span class="kb-topic-hits">{cov.hits} 段</span>}
          <Icon name={open ? "chevronDown" : "chevronRight"} tone="muted" size={14} />
        </button>
        {open && (
          <div class="kb-topic-body">
            <p class="kb-topic-why">{cov.topic.why}</p>
            {cov.matches.length > 0 && (
              <ul class="kb-topic-refs">
                {cov.matches.slice(0, 6).map((m) => (
                  <li key={m.chunkId}>
                    <button class="kb-ref" onClick={() => jumpToChunk(cov.topic, m.chunkId)}>
                      <Icon name="file" tone="muted" size={13} />
                      <span class="kb-ref-title">
                        {m.title}
                        {m.heading && <span class="muted"> › {m.heading}</span>}
                      </span>
                      <span class="kb-ref-excerpt">{m.excerpt}</span>
                    </button>
                  </li>
                ))}
                {cov.matches.length > 6 && <li class="muted kb-ref-more">还有 {cov.matches.length - 6} 段…</li>}
              </ul>
            )}
            {!cov.satisfied && (
              <p class="kb-topic-ask">
                <Icon name="alert" tone={cov.topic.required ? "danger" : "warn"} size={14} />
                <span>{cov.topic.askIfMissing}</span>
              </p>
            )}
            {fb && <FallbackBlock fb={fb} />}
            {contrasts.length > 0 && (
              <div class="kb-rel-row">
                <span class="kb-rel-label">易混对照</span>
                {contrasts.map((r) => (
                  <button key={r.topic.id} class="kb-chip kb-chip-contrast" onClick={() => gotoTopic(r.topic.id)}>
                    <Icon name="alert" size={12} />
                    {r.topic.name}
                  </button>
                ))}
              </div>
            )}
            {others.length > 0 && (
              <div class="kb-rel-row">
                <span class="kb-rel-label">相关</span>
                {others.map((r) => (
                  <button key={r.topic.id} class="kb-chip" title={r.kind} onClick={() => gotoTopic(r.topic.id)}>
                    <Icon name="link" size={12} />
                    {r.topic.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </li>
    );
  };

  const FixCard = ({ cov }: { cov: TopicCoverage }) => {
    const fb = fallbackFor(cov.topic.id);
    return (
      <div class="kb-fix-card">
        <div class="kb-fix-head">
          <Icon name="warning" tone="danger" size={15} />
          <strong>{cov.topic.name}</strong>
          {fb && <span class="kb-badge kb-badge-fallback">通用口径 · 可先看</span>}
        </div>
        <p class="kb-fix-why">不补会怎样：{cov.topic.why}</p>
        <p class="kb-fix-ask">
          <Icon name="alert" tone="warn" size={13} />
          怎么补：{cov.topic.askIfMissing}
        </p>
        <div class="kb-fix-actions">
          <button class="btn-link" onClick={() => copyText(`${cov.topic.name}：${cov.topic.why} ${cov.topic.askIfMissing}`)}>
            <Icon name="copy" size={12} /> 复制这句
          </button>
        </div>
        {fb && <FallbackBlock fb={fb} />}
      </div>
    );
  };

  const ModuleCard = ({ mod }: { mod: KnowledgeModule }) => {
    const prog = moduleProgress(mod.id, graph.coverage);
    const pct = prog.total ? Math.round((prog.done / prog.total) * 100) : 0;
    const left = prog.total - prog.done;
    return (
      <button class={`kb-module-card kb-module-${mod.stage ?? "neutral"}`} onClick={() => setActiveModule(mod.id)}>
        <div class="kb-module-name">{mod.name}</div>
        <div class="kb-module-line">
          <span>齐了 {prog.done} / 共 {prog.total} 条</span>
        </div>
        <div class="kb-module-bar">
          <div class="kb-module-bar-fill" style={{ width: `${pct}%` }} />
        </div>
        <div class="kb-module-worst">
          {prog.worstGap ? (
            <>
              <Icon name="warning" tone="danger" size={13} />
              <span>缺：{truncate(prog.worstGap.why, 40)}</span>
            </>
          ) : (
            <>
              <Icon name="check" tone="ok" size={13} />
              <span>必备的都齐了{left > 0 ? ` · 还有 ${left} 条建议项没补` : ""}</span>
            </>
          )}
        </div>
      </button>
    );
  };

  const LinkChips = ({ label, links, icon }: { label: string; links: TopicLink[]; icon: IconName }) => (
    <div class="kb-rel-row">
      <span class="kb-rel-label">{label}</span>
      {links.map((l) => (
        <button
          key={l.id}
          class={`kb-chip${l.kind === "contrast" ? " kb-chip-contrast" : ""}`}
          title={`${l.kindLabel} · 由「${l.fromTopic}」引出`}
          onClick={() => {
            const t = topicById(l.id);
            if (t) setQuery(t.satisfiedBy.keywords[0] ?? t.name);
          }}
        >
          <Icon name={icon} size={12} />
          {l.name}
        </button>
      ))}
    </div>
  );

  const DocAppraisalView = ({ a }: { a: DocAppraisal }) => (
    <div class="kb-appraisal">
      <div class="kb-appraisal-row">
        <span class="kb-usefulness" title="有用度：命中了多少条必备主题">
          有用度 {"★".repeat(a.usefulness)}
          <span class="muted">{"★".repeat(5 - a.usefulness)}</span>
        </span>
        <span class="muted">阅读约 {a.readingTime} 分钟</span>
      </div>
      <p class="kb-appraisal-why">{a.usefulnessWhy}</p>
      {a.missing.length > 0 && (
        <div class="kb-appraisal-missing">
          <strong>没写什么</strong>
          <ul>
            {a.missing.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        </div>
      )}
      {a.quality.warnings.length > 0 && (
        <div class="kb-appraisal-warn">
          <strong>留意</strong>
          <ul>
            {a.quality.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );

  const activeMod = activeModule ? MODULES.find((m) => m.id === activeModule) : undefined;
  const moduleCoverage = activeMod ? graph.coverage.filter((c) => activeMod.topicIds.includes(c.topic.id)) : [];
  const activeModProg = activeMod ? moduleProgress(activeMod.id, graph.coverage) : undefined;
  const fixFirst = moduleCoverage.filter((c) => c.topic.required && !c.satisfied).slice(0, 3);

  return (
    // page 模式下不套遮罩、铺满主区；drawer 模式保留原来的右侧抽屉
    <div class={mode === "page" ? "kb-page" : "drawer-backdrop"} onClick={mode === "page" ? undefined : onClose}>
      <aside class={`drawer kb-drawer${mode === "page" ? " as-page" : ""}`} onClick={(e) => e.stopPropagation()}>
        <header>
          <h3>文档知识库</h3>
          <button class="btn-link" onClick={onClose}>关闭</button>
        </header>

        <nav class="kb-tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              class={`kb-tab${tab === t.id ? " active" : ""}`}
              onClick={() => {
                setTab(t.id);
                if (t.id === "system") setActiveModule(null);
              }}
            >
              <Icon name={t.icon} size={14} />
              {t.label}
              {t.id === "system" && supported && gapCount > 0 && <span class="kb-tab-dot" />}
            </button>
          ))}
        </nav>

        <div class="kb-body" ref={bodyRef}>
          {/* ---------------- 体系：六个模块，先首屏后详情 ---------------- */}
          {tab === "system" && (
            <section>
              {!supported ? (
                <div class="kb-empty">
                  <p class="kb-empty-title">
                    <Icon name="knowledge" size={15} /> 这是一份按业务动作分好的采购知识体系
                  </p>
                  <p class="muted">
                    网页版没有本地数据库，盘不了「你的库里有没有」，但六个模块照样能看——需求与算量、
                    下单与回签、在途与催货、到货与入库、钱与票、规矩与底线，一共 {MODULES.reduce((s, m) => s + m.topicIds.length, 0)} 条。
                    回头在桌面版导进来，就能一条条打勾。
                  </p>
                </div>
              ) : activeMod && activeModProg ? (
                // ---------- 模块详情 ----------
                <>
                  <div class="kb-module-detail-head">
                    <button class="btn-link" onClick={() => setActiveModule(null)}>
                      <Icon name="chevronRight" size={13} style={{ transform: "rotate(180deg)" }} /> 返回
                    </button>
                    <span class={`kb-module-dot kb-module-${activeMod.stage ?? "neutral"}`} />
                    <h4>{activeMod.name}</h4>
                    <span class="muted">齐了 {activeModProg.done} / 共 {activeModProg.total} 条</span>
                  </div>
                  <p class="muted kb-module-blurb">{activeMod.blurb}</p>

                  {fixFirst.length > 0 && (
                    <div class="kb-fix-list">
                      <h4>
                        <Icon name="alert" tone="danger" size={14} /> 先补这几条（不补会直接出事）
                      </h4>
                      {fixFirst.map((c) => (
                        <FixCard key={c.topic.id} cov={c} />
                      ))}
                    </div>
                  )}

                  <div class="kb-cat">
                    <div class="kb-cat-head">
                      <Icon name="folder" tone="muted" size={14} />
                      <span class="kb-cat-name">这个模块里的全部主题</span>
                    </div>
                    <ul class="kb-topics">
                      {moduleCoverage.map((cov) => (
                        <TopicRow key={cov.topic.id} cov={cov} />
                      ))}
                    </ul>
                  </div>
                </>
              ) : (
                // ---------- 首屏：只有六张模块卡，不出现任何主题名 ----------
                <>
                  <div class="kb-progress-card">
                    <div class="kb-progress-head">
                      <Icon name={summary.mustCount ? "warning" : "check"} tone={summary.mustCount ? "warn" : "ok"} size={16} />
                      <strong>必备主题覆盖 {summary.requiredSatisfied}/{summary.requiredTotal}</strong>
                    </div>
                    <div class="kb-progress-seg">
                      <div class="kb-progress-seg-covered" style={{ width: `${coveredPct}%` }} />
                      <div class="kb-progress-seg-fallback" style={{ width: `${fallbackPct}%` }} />
                      <div class="kb-progress-seg-bare" style={{ width: `${barePct}%` }} />
                    </div>
                    <p class="muted kb-progress-note">{graphLoading ? "正在把文档挂到体系上…" : summary.message}</p>
                  </div>

                  <input
                    class="kb-search kb-quickjump"
                    type="search"
                    placeholder="搜知识库…（直接搜主题、术语、文件名，不用先选模块）"
                    onInput={(e) => quickJump((e.target as HTMLInputElement).value)}
                  />

                  <div class="kb-modules-grid">
                    {MODULES.map((m) => (
                      <ModuleCard key={m.id} mod={m} />
                    ))}
                  </div>

                  <button class="btn" onClick={() => setTab("docs")}>
                    <Icon name="import" size={14} /> 导入文档
                  </button>
                </>
              )}
            </section>
          )}

          {/* ---------------- 文档 ---------------- */}
          {tab === "docs" && (
            <>
              {!supported && (
                <section class="kb-empty">
                  <p class="kb-empty-title">
                    <Icon name="folder" size={15} /> 桌面版专属
                  </p>
                  <p class="muted">
                    文档知识库要把切好的知识块写进本地 SQLite 全文索引，网页版没有本地数据库，所以这里是空的。
                    在小采桌面版里打开同一个面板，就能把制度、SOP、报价单导进来随时检索。
                  </p>
                </section>
              )}
              {supported && (
                <>
                  <section>
                    <h4><Icon name="import" size={15} /> 导入文档</h4>
                    <p class="muted">支持 {ACCEPT.replace(/,/g, " / ")}，单个文件 5MB 以内，可一次选多个。文档只存在这台电脑上。</p>
                    <input ref={fileRef} type="file" accept={ACCEPT} multiple hidden onChange={onPick} />
                    <div
                      class={`kb-drop${dragging ? " dragging" : ""}`}
                      onClick={() => !importing && fileRef.current?.click()}
                      onDragOver={(e) => {
                        e.preventDefault();
                        setDragging(true);
                      }}
                      onDragLeave={() => setDragging(false)}
                      onDrop={onDrop}
                    >
                      {importing ? "导入中…" : "把文件拖到这里，或点击选择"}
                    </div>

                    {imports.length > 0 && (
                      <ul class="kb-imports">
                        {imports.map((it, i) => (
                          <li key={`${it.name}-${i}`} class={`kb-import kb-import-${it.state}`}>
                            <div class="kb-import-name">{it.name}</div>
                            <div class="kb-import-msg">
                              {it.state === "ok" && <Icon name="check" tone="ok" size={13} />}
                              {it.state === "fail" && <Icon name="close" tone="danger" size={13} />}
                              <span>{it.message}</span>
                            </div>
                            {it.warnings.map((w, k) => (
                              <div key={k} class="kb-import-warn">
                                <Icon name="warning" tone="warn" size={13} />
                                <span>{w}</span>
                              </div>
                            ))}
                          </li>
                        ))}
                      </ul>
                    )}
                    {error && <p class="error kb-error">{error}</p>}
                  </section>

                  <section>
                    <h4><Icon name="folder" size={15} /> 已入库文档{shown.length ? ` · ${shown.length}` : ""}</h4>
                    <div class="kb-chips">
                      <button class={`kb-chip${filter === "all" ? " active" : ""}`} onClick={() => setFilter("all")}>
                        全部 {docs.length}
                      </button>
                      {CATEGORIES.filter((c) => used.has(c.id)).map((c) => (
                        <button
                          key={c.id}
                          class={`kb-chip${filter === c.id ? " active" : ""}`}
                          title={c.desc}
                          onClick={() => setFilter(filter === c.id ? "all" : c.id)}
                        >
                          {c.name} {docs.filter((d) => d.category === c.id).length}
                        </button>
                      ))}
                    </div>
                    {!shown.length && <p class="muted">{docs.length ? "这个分类下还没有文档。" : "还没有导入任何文档。"}</p>}
                    <ul class="kb-list">
                      {shown.map((d) => (
                        <li key={d.id} class="kb-item">
                          <div class="kb-item-main">
                            <button class="kb-item-toggle" onClick={() => toggleDoc(d.id)}>
                              <div class="kb-item-name">{d.title}</div>
                              <Icon name={openDocs.has(d.id) ? "chevronDown" : "chevronRight"} tone="muted" size={13} />
                            </button>
                            {d.summary && <div class="kb-item-summary">{d.summary}</div>}
                            <div class="kb-item-meta">
                              <span class="kb-tag">{categoryName(d.category)}</span>
                              {d.chunkCount} 块 · {d.charCount} 字 · {format(new Date(d.updatedAt), "MM-dd HH:mm")}
                            </div>
                            {openDocs.has(d.id) &&
                              (d.appraisal ? (
                                <DocAppraisalView a={d.appraisal} />
                              ) : (
                                <p class="muted kb-appraisal-none">这份文档还没有评价（老文档，导入时评价功能还不存在）。</p>
                              ))}
                          </div>
                          <button class="btn-icon" title="从知识库删除" onClick={() => doDelete(d)}>
                            <Icon name="trash" size={15} />
                          </button>
                        </li>
                      ))}
                    </ul>
                  </section>
                </>
              )}
            </>
          )}

          {/* ---------------- 搜索 ---------------- */}
          {tab === "search" && (
            <section>
              {!supported ? (
                <div class="kb-empty">
                  <p class="kb-empty-title">
                    <Icon name="search" size={15} /> 桌面版专属
                  </p>
                  <p class="muted">全文检索走的是本地 SQLite 索引，网页版没有。先在「体系」页照单子把资料要齐，回到桌面版再导进来搜。</p>
                </div>
              ) : (
                <>
                  <input
                    class="kb-search"
                    type="search"
                    placeholder="搜知识库：到货预告怎么发 / MOQ 凑整 / 参照订单生单…"
                    value={query}
                    onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
                  />
                  <div class="kb-chips">
                    <button class={`kb-chip${filter === "all" ? " active" : ""}`} onClick={() => setFilter("all")}>
                      全部 {docs.length}
                    </button>
                    {CATEGORIES.filter((c) => used.has(c.id)).map((c) => (
                      <button
                        key={c.id}
                        class={`kb-chip${filter === c.id ? " active" : ""}`}
                        title={c.desc}
                        onClick={() => setFilter(filter === c.id ? "all" : c.id)}
                      >
                        {c.name} {docs.filter((d) => d.category === c.id).length}
                      </button>
                    ))}
                  </div>

                  {!query.trim() && <p class="muted">输入关键词就搜；结果下面会挂上「相关」和「易混对照」，可以顺着一路查下去。</p>}
                  {query.trim() && (
                    <div class="kb-results">
                      {searching && <p class="muted">检索中…</p>}
                      {!searching && !hits.length && <p class="muted">没搜到。换个说法试试，或者先把相关文档导进来。</p>}
                      {hits.map((h) => (
                        <article
                          key={h.chunkId}
                          data-chunk={h.chunkId}
                          class={`kb-hit${focusChunk === h.chunkId ? " focus" : ""}`}
                        >
                          <div class="kb-hit-head">
                            <span class="kb-hit-title">{h.title}</span>
                            {h.heading && <span class="kb-hit-path"> › {h.heading}</span>}
                          </div>
                          <p class="kb-hit-text">
                            {splitHighlight(h.snippet).map((p, i) => (p.hit ? <mark key={i}>{p.text}</mark> : <span key={i}>{p.text}</span>))}
                          </p>
                          <div class="kb-hit-meta">
                            <span class="kb-tag">{h.categoryLabel}</span>
                            {h.topics.slice(0, 3).map((t) => (
                              <button key={t.id} class="kb-chip kb-chip-ghost" onClick={() => gotoTopic(t.id)}>
                                <Icon name="knowledge" size={12} />
                                {t.name}
                              </button>
                            ))}
                            <span class="muted">相关度 {h.score.toFixed(2)}</span>
                          </div>
                          {h.contrasts.length > 0 && <LinkChips label="易混对照" links={h.contrasts} icon="alert" />}
                          {h.related.length > 0 && <LinkChips label="相关" links={h.related} icon="link" />}
                        </article>
                      ))}
                    </div>
                  )}
                </>
              )}
            </section>
          )}
        </div>
      </aside>
    </div>
  );
}
