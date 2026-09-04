// 知识库检索的前端封装：把主进程的 kb.search（SQLite FTS5 + 中文 bigram）包成 UI 能直接用的形状——
// 补上分类中文名、截出片段、把命中词用 **粗体** 标出来。
// 网页版没有本地库，这里一律返回空/抛中文错，由面板显示「桌面版专属」，不让调用点自己判平台。
import { desktop, isDesktop } from "../data/bridge";
import { categoryName, isCategoryId, type CategoryId } from "./classify";
import { buildGraph, emptyGraph, matchTopics, type GraphChunk, type KnowledgeGraph } from "./graph";
import { RELATION_LABEL, relationsOf, TOPICS, type RelationKind } from "./taxonomy";

export interface KbDoc {
  id: string;
  title: string;
  sourceName?: string | null;
  mime?: string | null;
  category: string;
  tags: string[];
  summary?: string | null;
  charCount: number;
  chunkCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface KbHit {
  chunkId: string;
  docId: string;
  /** 文档标题 */
  title: string;
  /** 标题链，如「采购制度 > 请购流程」 */
  heading: string;
  category: CategoryId;
  /** 分类中文名 */
  categoryLabel: string;
  /** 块原文 */
  text: string;
  /** 命中处附近的片段，命中词用 **粗体** 包起来 */
  snippet: string;
  score: number;
  /** 这一段命中了体系里的哪些主题 */
  topics: { id: string; name: string }[];
  /** 顺着查：前置 / 下游 / 同一份文件 */
  related: TopicLink[];
  /** 易混对照单独拎出来——搜「可用量」要当场告诉她别跟「现存量」搞混 */
  contrasts: TopicLink[];
}

export interface TopicLink {
  id: string;
  name: string;
  kind: RelationKind;
  /** 关系的中文名，直接当标签显示 */
  kindLabel: string;
  /** 从哪条主题引出来的，UI 上可以写「因为这段讲的是 X」 */
  fromTopic: string;
}

export interface SearchOptions {
  limit?: number;
  category?: string;
  /** 片段长度（字符），默认 160 */
  snippetWidth?: number;
  /** 每条结果最多挂几个关联标签，默认 4 */
  linkLimit?: number;
}

interface RawHit {
  chunkId: string;
  docId: string;
  title: string;
  heading: string | null;
  category: string | null;
  text: string;
  score: number;
}

const HAN = /\p{Script=Han}/u;

/**
 * 查询词 → 高亮候选。
 * 中文连续段整段一个词；超过 2 字的再补 bigram（主进程 FTS 就是按 bigram 索引的，
 * 只标整段的话「到货预告」查「到货」会一个字都不标）。英文/数字按整段小写。
 */
export function queryTerms(query: string): string[] {
  const out = new Set<string>();
  for (const seg of String(query ?? "").split(/[^\p{L}\p{N}]+/u)) {
    if (!seg) continue;
    if (!HAN.test(seg)) {
      if (seg.length >= 2) out.add(seg.toLowerCase());
      continue;
    }
    const chars = Array.from(seg);
    if (chars.length === 1) out.add(seg);
    else {
      out.add(seg);
      if (chars.length > 2) for (let i = 0; i + 1 < chars.length; i++) out.add(chars[i] + chars[i + 1]);
    }
  }
  // 长词优先，贪心配对时先吃掉整段
  return [...out].sort((a, b) => b.length - a.length);
}

interface Span {
  start: number;
  end: number;
}

/** 文本里所有命中位置，长词优先、互不重叠 */
function matchSpans(text: string, terms: string[]): Span[] {
  const lower = text.toLowerCase();
  const spans: Span[] = [];
  const taken = new Uint8Array(text.length);
  for (const term of terms) {
    const t = term.toLowerCase();
    let i = lower.indexOf(t);
    while (i >= 0) {
      let free = true;
      for (let k = i; k < i + t.length; k++) if (taken[k]) { free = false; break; }
      if (free) {
        for (let k = i; k < i + t.length; k++) taken[k] = 1;
        spans.push({ start: i, end: i + t.length });
      }
      i = lower.indexOf(t, i + t.length);
    }
  }
  return spans.sort((a, b) => a.start - b.start);
}

/** 把命中词用 **粗体** 包起来（相邻命中会合并，避免 **到**​**货** 这种碎星号） */
export function highlight(text: string, terms: string[]): string {
  const spans = matchSpans(text, terms);
  if (!spans.length) return text;
  const merged: Span[] = [];
  for (const s of spans) {
    const last = merged[merged.length - 1];
    if (last && s.start <= last.end) last.end = Math.max(last.end, s.end);
    else merged.push({ ...s });
  }
  let out = "";
  let cur = 0;
  for (const s of merged) {
    out += text.slice(cur, s.start) + "**" + text.slice(s.start, s.end) + "**";
    cur = s.end;
  }
  return out + text.slice(cur);
}

/** 截命中处附近的片段并高亮；没命中就截开头 */
export function makeSnippet(text: string, terms: string[], width = 160): string {
  const flat = text.replace(/\s*\n+\s*/g, " ").trim();
  const spans = matchSpans(flat, terms);
  const first = spans[0]?.start ?? 0;
  const start = Math.max(0, first - Math.floor(width / 4));
  const end = Math.min(flat.length, start + width);
  const body = flat.slice(start, end);
  return (start > 0 ? "…" : "") + highlight(body, terms) + (end < flat.length ? "…" : "");
}

/** 高亮串 → 片段数组，给 Preact 渲染（不走 dangerouslySetInnerHTML） */
export function splitHighlight(marked: string): { text: string; hit: boolean }[] {
  return marked
    .split(/(\*\*[^*]+\*\*)/g)
    .filter(Boolean)
    .map((p) => (p.startsWith("**") && p.endsWith("**") ? { text: p.slice(2, -2), hit: true } : { text: p, hit: false }));
}

/**
 * 一段命中文本 → 顺着查的关联标签。
 * 先看这段讲的是哪几条主题，再把这些主题的关联铺开；已经在本段里的主题不重复挂。
 * contrast 单拎一组：搜「可用量」时最该看见的就是「别跟现存量搞混」。
 */
export function linksForText(text: string, heading = "", limit = 4): { topics: { id: string; name: string }[]; related: TopicLink[]; contrasts: TopicLink[] } {
  const own = matchTopics(text, heading).map((m) => m.topic);
  const ownIds = new Set(own.map((t) => t.id));
  const related: TopicLink[] = [];
  const contrasts: TopicLink[] = [];
  const seen = new Set<string>();
  for (const src of own) {
    for (const r of relationsOf(src.id)) {
      if (ownIds.has(r.topic.id) || seen.has(r.topic.id)) continue;
      seen.add(r.topic.id);
      const link: TopicLink = {
        id: r.topic.id,
        name: r.topic.name,
        kind: r.kind,
        kindLabel: RELATION_LABEL[r.kind],
        fromTopic: src.name,
      };
      (r.kind === "contrast" ? contrasts : related).push(link);
    }
  }
  return {
    topics: own.map((t) => ({ id: t.id, name: t.name })),
    related: related.slice(0, limit),
    contrasts: contrasts.slice(0, limit),
  };
}

/** 全文检索。网页版返回 []（面板负责给「桌面版专属」的提示）。 */
export async function searchKnowledgeBase(query: string, opts: SearchOptions = {}): Promise<KbHit[]> {
  const q = String(query ?? "").trim();
  if (!q || !isDesktop()) return [];
  const rows = await desktop().call<RawHit[]>("kb.search", q, {
    limit: opts.limit ?? 8,
    category: opts.category && opts.category !== "all" ? opts.category : undefined,
  });
  const terms = queryTerms(q);
  return (rows ?? []).map((r) => {
    const category = (r.category && isCategoryId(r.category) ? r.category : "other") as CategoryId;
    const links = linksForText(r.text, r.heading ?? "", opts.linkLimit ?? 4);
    return {
      chunkId: r.chunkId,
      docId: r.docId,
      title: r.title,
      heading: r.heading ?? "",
      category,
      categoryLabel: categoryName(category),
      text: r.text,
      snippet: makeSnippet(r.text, terms, opts.snippetWidth),
      score: r.score,
      ...links,
    };
  });
}

/** 已入库文档列表（按更新时间倒序，主进程排好） */
export async function listDocs(): Promise<KbDoc[]> {
  if (!isDesktop()) return [];
  const rows = await desktop().call<KbDoc[]>("kb.listDocs");
  return (rows ?? []).map((d) => ({ ...d, tags: Array.isArray(d.tags) ? d.tags : [] }));
}

/** 删除一份文档及其全部块（含 FTS 索引），返回删掉的块数 */
export async function removeDoc(docId: string): Promise<number> {
  if (!isDesktop()) throw new Error("文档知识库是桌面版功能，网页版没有本地数据库。");
  return (await desktop().call<number>("kb.deleteDoc", docId)) ?? 0;
}

// ---------- 体系视图的数据源 ----------
//
// buildGraph 要全量切片，但主进程当前只有 kb.search / kb.listDocs，没有「列出所有切片」的接口。
// 所以这里两条路：
//   1) 优先调 kb.listChunks（等主进程加上就自动走这条，一次查询拿全量，最准）；
//   2) 没有这个接口就退回「按主题关键词各搜一轮」，把召回的切片汇成一个池子再判定。
//      够用但有天花板：每个主题只看前 PROBE_LIMIT 条，命中数会偏少，达标线因此按「至少 1~2 段」定，
//      而不是按比例定——比例在抽样池上没有意义。

/** 主进程若实现这个通道，就能一次拿到全量切片（见回复里的接线清单） */
export const CHUNKS_CHANNEL = "kb.listChunks";
const PROBE_LIMIT = 30;

interface RawChunk {
  id?: string;
  chunkId?: string;
  docId: string;
  heading?: string | null;
  text: string;
  category?: string | null;
}

const toGraphChunk = (r: RawChunk): GraphChunk => ({
  id: r.id ?? r.chunkId ?? "",
  docId: r.docId,
  heading: r.heading ?? "",
  text: r.text ?? "",
  category: r.category ?? null,
});

async function listAllChunks(): Promise<GraphChunk[] | null> {
  try {
    const rows = await desktop().call<RawChunk[]>(CHUNKS_CHANNEL);
    if (!Array.isArray(rows)) return null;
    return rows.map(toGraphChunk).filter((c) => c.id && c.text);
  } catch {
    return null; // 主进程还没这个接口，走探针
  }
}

async function probeChunks(): Promise<GraphChunk[]> {
  const pool = new Map<string, GraphChunk>();
  for (const t of TOPICS) {
    const q = t.satisfiedBy.keywords.join(" ");
    let rows: RawHit[] | null = null;
    try {
      rows = await desktop().call<RawHit[]>("kb.search", q, { limit: PROBE_LIMIT });
    } catch {
      break; // 检索本身挂了就别再刷四十次
    }
    for (const r of rows ?? []) {
      if (!pool.has(r.chunkId)) pool.set(r.chunkId, toGraphChunk({ ...r, id: r.chunkId }));
    }
  }
  return [...pool.values()];
}

/** 体系视图的入口：拉文档 + 切片，挂到 taxonomy 骨架上。网页版返回空骨架（全部未覆盖）。 */
export async function loadKnowledgeGraph(): Promise<KnowledgeGraph> {
  if (!isDesktop()) return emptyGraph();
  const docs = await listDocs();
  if (!docs.length) return emptyGraph();
  const chunks = (await listAllChunks()) ?? (await probeChunks());
  return buildGraph(docs.map((d) => ({ id: d.id, title: d.title, category: d.category })), chunks);
}
