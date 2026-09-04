import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { format } from "date-fns";
import { isDesktop } from "../data/bridge";
import { CATEGORIES, categoryName } from "../knowledge/classify";
import { findGaps, gapSummary, topGaps, type KnowledgeGap } from "../knowledge/gaps";
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
import { relationsOf, topicById, type TopicSpec } from "../knowledge/taxonomy";
import { Icon, type IconName } from "./icons";
import "./KnowledgePanel.css";

// 结构与 class 命名跟着 MaterialsPanel 走（drawer / btn / muted 来自 styles.css），只加 .kb-* 前缀类。
// 三个视图：体系（骨架 + 缺口）/ 文档（导入 + 已入库）/ 搜索（检索 + 顺着查）。
// 图标一律走 ui/icons 的 SVG，界面里不出现 emoji。

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

/** 主题状态 → 图标与语气：已覆盖 / 必备缺失 / 建议补充 */
function topicMark(cov: TopicCoverage): { icon: IconName; tone: "ok" | "danger" | "muted"; label: string } {
  if (cov.satisfied) return { icon: "check", tone: "ok", label: "已覆盖" };
  if (cov.topic.required) return { icon: "warning", tone: "danger", label: "必备缺失" };
  return { icon: "gap", tone: "muted", label: "建议补充" };
}

export function KnowledgePanel({ onClose, mode = "page" }: { onClose: () => void; mode?: "page" | "drawer" }) {
  const supported = isDesktop();
  const [tab, setTab] = useState<Tab>("system");
  const [docs, setDocs] = useState<KbDoc[]>([]);
  const [graph, setGraph] = useState<KnowledgeGraph>(() => emptyGraph());
  const [graphLoading, setGraphLoading] = useState(false);
  const [openTopics, setOpenTopics] = useState<Set<string>>(new Set());
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
      setDocs(await listDocs());
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

  /** 体系视图 → 搜索视图：用主题的头号关键词把那一段捞出来，滚到它 */
  const jumpToChunk = (topic: TopicSpec, chunkId: string) => {
    setFilter("all");
    setQuery(topic.satisfiedBy.keywords[0] ?? topic.name);
    setFocusChunk(chunkId);
    setTab("search");
  };

  /** 顺着关联查：点一个主题标签就展开它，并滚过去 */
  const gotoTopic = (topicId: string) => {
    setTab("system");
    setOpenTopics((prev) => new Set(prev).add(topicId));
    requestAnimationFrame(() => {
      bodyRef.current?.querySelector(`[data-topic="${topicId}"]`)?.scrollIntoView({ block: "center" });
    });
  };

  const summary = useMemo(() => gapSummary(graph), [graph]);
  const musts = useMemo(() => topGaps(graph, 3).filter((g) => g.severity === "must"), [graph]);
  const gapCount = useMemo(() => findGaps(graph).length, [graph]);
  const shown = filter === "all" ? docs : docs.filter((d) => d.category === filter);
  // 标签条只显示实际有文档的分类，免得一排空标签
  const used = new Set(docs.map((d) => d.category));
  const pct = summary.requiredTotal ? Math.round((summary.requiredSatisfied / summary.requiredTotal) * 100) : 0;

  const TopicRow = ({ cov }: { cov: TopicCoverage }) => {
    const mark = topicMark(cov);
    const open = openTopics.has(cov.topic.id);
    const rels = relationsOf(cov.topic.id);
    const contrasts = rels.filter((r) => r.kind === "contrast");
    const others = rels.filter((r) => r.kind !== "contrast");
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

  const GapLine = ({ gap }: { gap: KnowledgeGap }) => (
    <li class="kb-gap">
      <Icon name="warning" tone="danger" size={15} />
      <div>
        <button class="kb-gap-name" onClick={() => gotoTopic(gap.topic.id)}>
          {categoryName(gap.topic.category)} · {gap.topic.name}
        </button>
        <p class="kb-gap-ask">{gap.ask}</p>
        {gap.alsoCovers.length > 0 && (
          <p class="kb-gap-also">
            <Icon name="link" tone="muted" size={12} />
            顺带能补齐：{gap.alsoCovers.map((t) => t.name).join("、")}
          </p>
        )}
      </div>
    </li>
  );

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
            <button key={t.id} class={`kb-tab${tab === t.id ? " active" : ""}`} onClick={() => setTab(t.id)}>
              <Icon name={t.icon} size={14} />
              {t.label}
              {t.id === "system" && supported && gapCount > 0 && <span class="kb-tab-dot" />}
            </button>
          ))}
        </nav>

        <div class="kb-body" ref={bodyRef}>
          {/* ---------------- 体系 ---------------- */}
          {tab === "system" && (
            <section>
              {!supported ? (
                <div class="kb-empty">
                  <p class="kb-empty-title">
                    <Icon name="knowledge" size={15} /> 这是一份采购知识体系的清单
                  </p>
                  <p class="muted">
                    网页版没有本地数据库，盘不了「你的库里有没有」，但下面这张骨架照样能用——
                    它列的是一个采购专员该有的 {graph.total} 条主题（其中 {graph.requiredTotal} 条必备）。
                    照着它去要文件，回头在桌面版导进来，就能一条条打勾。
                  </p>
                </div>
              ) : (
                <>
                  <div class="kb-progress-card">
                    <div class="kb-progress-head">
                      <Icon name={summary.mustCount ? "warning" : "check"} tone={summary.mustCount ? "warn" : "ok"} size={16} />
                      <strong>必备主题覆盖 {summary.requiredSatisfied}/{summary.requiredTotal}</strong>
                      <span class="muted">全部主题 {graph.satisfied}/{graph.total}</span>
                    </div>
                    <div class="kb-progress"><div class="kb-progress-fill" style={{ width: `${pct}%` }} /></div>
                    <p class="muted kb-progress-note">{graphLoading ? "正在把文档挂到体系上…" : summary.headline}</p>
                  </div>

                  {musts.length > 0 && (
                    <div class="kb-gaps">
                      <h4><Icon name="alert" tone="danger" size={15} /> 最紧要的 {musts.length} 条缺口</h4>
                      <ul>{musts.map((g) => <GapLine key={g.topic.id} gap={g} />)}</ul>
                    </div>
                  )}
                </>
              )}

              {CATEGORIES.map((c) => {
                const rows = graph.coverage.filter((x) => x.topic.category === c.id);
                if (!rows.length) return null;
                const ok = rows.filter((x) => x.satisfied).length;
                return (
                  <div key={c.id} class="kb-cat">
                    <div class="kb-cat-head" title={c.desc}>
                      <Icon name="folder" tone="muted" size={14} />
                      <span class="kb-cat-name">{c.name}</span>
                      {supported && <span class="muted">{ok}/{rows.length}</span>}
                    </div>
                    <ul class="kb-topics">{rows.map((cov) => <TopicRow key={cov.topic.id} cov={cov} />)}</ul>
                  </div>
                );
              })}
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
                            <div class="kb-item-name">{d.title}</div>
                            {d.summary && <div class="kb-item-summary">{d.summary}</div>}
                            <div class="kb-item-meta">
                              <span class="kb-tag">{categoryName(d.category)}</span>
                              {d.chunkCount} 块 · {d.charCount} 字 · {format(new Date(d.updatedAt), "MM-dd HH:mm")}
                            </div>
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
