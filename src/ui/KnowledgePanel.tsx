import { useEffect, useRef, useState } from "preact/hooks";
import { format } from "date-fns";
import { isDesktop } from "../data/bridge";
import { CATEGORIES, categoryName } from "../knowledge/classify";
import { SUPPORTED_EXTS, ingestFile } from "../knowledge/ingest";
import { listDocs, removeDoc, searchKnowledgeBase, splitHighlight, type KbDoc, type KbHit } from "../knowledge/kb";
import "./KnowledgePanel.css";

// 结构与 class 命名跟着 MaterialsPanel 走（drawer / btn / muted 来自 styles.css），只加 .kb-* 前缀类。

const ACCEPT = SUPPORTED_EXTS.map((e) => `.${e}`).join(",");
const DEBOUNCE_MS = 250;

interface ImportItem {
  name: string;
  state: "wait" | "doing" | "ok" | "fail";
  /** 成功=「分类 · N 块」，失败=中文原因 */
  message: string;
  warnings: string[];
}

export function KnowledgePanel({ onClose }: { onClose: () => void }) {
  const supported = isDesktop();
  const [docs, setDocs] = useState<KbDoc[]>([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<string>("all");
  const [hits, setHits] = useState<KbHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [imports, setImports] = useState<ImportItem[]>([]);
  const [importing, setImporting] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string>();
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = async () => {
    try {
      setDocs(await listDocs());
    } catch (err: any) {
      setError(`读知识库失败：${err?.message ?? String(err)}`);
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

  const shown = filter === "all" ? docs : docs.filter((d) => d.category === filter);
  // 标签条只显示实际有文档的分类，免得一排空标签
  const used = new Set(docs.map((d) => d.category));

  return (
    <div class="drawer-backdrop" onClick={onClose}>
      <aside class="drawer kb-drawer" onClick={(e) => e.stopPropagation()}>
        <header>
          <h3>文档知识库</h3>
          <button class="btn-link" onClick={onClose}>关闭</button>
        </header>

        {!supported && (
          <section class="kb-empty">
            <p class="kb-empty-title">桌面版专属</p>
            <p class="muted">
              文档知识库要把切好的知识块写进本地 SQLite 全文索引，网页版没有本地数据库，所以这里是空的。
              在小采桌面版里打开同一个面板，就能把制度、SOP、报价单导进来随时检索。
            </p>
          </section>
        )}

        {supported && (
          <>
            <section>
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

              {query.trim() && (
                <div class="kb-results">
                  {searching && <p class="muted">检索中…</p>}
                  {!searching && !hits.length && <p class="muted">没搜到。换个说法试试，或者先把相关文档导进来。</p>}
                  {hits.map((h) => (
                    <article key={h.chunkId} class="kb-hit">
                      <div class="kb-hit-head">
                        <span class="kb-hit-title">{h.title}</span>
                        {h.heading && <span class="kb-hit-path"> › {h.heading}</span>}
                      </div>
                      <p class="kb-hit-text">
                        {splitHighlight(h.snippet).map((p, i) => (p.hit ? <mark key={i}>{p.text}</mark> : <span key={i}>{p.text}</span>))}
                      </p>
                      <div class="kb-hit-meta">
                        <span class="kb-tag">{h.categoryLabel}</span>
                        <span class="muted">相关度 {h.score.toFixed(2)}</span>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>

            <section>
              <h4>导入文档</h4>
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
                        {it.state === "ok" ? "✓ " : it.state === "fail" ? "✕ " : ""}
                        {it.message}
                      </div>
                      {it.warnings.map((w, k) => (
                        <div key={k} class="kb-import-warn">⚠️ {w}</div>
                      ))}
                    </li>
                  ))}
                </ul>
              )}
              {error && <p class="error kb-error">{error}</p>}
            </section>

            <section>
              <h4>已入库文档{shown.length ? ` · ${shown.length}` : ""}</h4>
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
                    <button class="btn-icon" title="从知识库删除" onClick={() => doDelete(d)}>删除</button>
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}
      </aside>
    </div>
  );
}
