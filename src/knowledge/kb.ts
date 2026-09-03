// 知识库检索的前端封装：把主进程的 kb.search（SQLite FTS5 + 中文 bigram）包成 UI 能直接用的形状——
// 补上分类中文名、截出片段、把命中词用 **粗体** 标出来。
// 网页版没有本地库，这里一律返回空/抛中文错，由面板显示「桌面版专属」，不让调用点自己判平台。
import { desktop, isDesktop } from "../data/bridge";
import { categoryName, isCategoryId, type CategoryId } from "./classify";

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
}

export interface SearchOptions {
  limit?: number;
  category?: string;
  /** 片段长度（字符），默认 160 */
  snippetWidth?: number;
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
