// 把已入库的文档挂到 taxonomy 的骨架上：哪条主题有人写过、写在哪份文档的哪一段、还差什么。
//
// 纯函数，零 IO：喂它文档列表和切片列表，吐出覆盖情况与关联边。数据从哪来（SQLite / 内存 / 测试造的）
// 一概不管，这样 vitest 里能直接构造几条 chunk 验判定，不用起 Electron。
//
// 命中判定刻意做得保守可解释：切片里出现主题的任一关键词就算这条切片覆盖了它，
// 主题满足 = 命中切片数 ≥ minChunks（默认 1）。不做语义相似度——
// 一来本地没模型，二来「解释不清为什么算命中」的达标线，用户不会信。

import { RELATIONS, relationsOf, TOPICS, topicById, type RelationKind, type TopicSpec } from "./taxonomy";

export interface GraphDoc {
  id: string;
  title: string;
  category?: string | null;
}

export interface GraphChunk {
  id: string;
  docId: string;
  heading?: string | null;
  text: string;
  category?: string | null;
}

export interface TopicMatch {
  docId: string;
  title: string;
  chunkId: string;
  heading: string;
  /** 命中处附近的一小段原文，给面板直接显示 */
  excerpt: string;
  /** 这一段命中了哪些关键词，用户要能看出「凭什么算覆盖了」 */
  keywords: string[];
}

export interface TopicCoverage {
  topic: TopicSpec;
  docIds: string[];
  chunkIds: string[];
  /** 命中的切片数 */
  hits: number;
  satisfied: boolean;
  matches: TopicMatch[];
}

export interface TopicEdge {
  from: string;
  to: string;
  kind: RelationKind;
}

export interface KnowledgeGraph {
  coverage: TopicCoverage[];
  edges: TopicEdge[];
  /** 主题总数 */
  total: number;
  /** 已覆盖的主题数（含非必备） */
  satisfied: number;
  requiredTotal: number;
  requiredSatisfied: number;
}

const EXCERPT_WIDTH = 90;

const isAscii = (w: string) => /^[\x20-\x7e]+$/.test(w);
const escapeRe = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const asciiRe = new Map<string, RegExp>();

/** ASCII 关键词要加边界，否则 moq 会命中 moqu、u8 会命中 u80；中文直接子串匹配 */
function contains(haystack: string, word: string): boolean {
  const w = word.toLowerCase().trim();
  if (!w) return false;
  if (!isAscii(w)) return haystack.includes(w);
  let re = asciiRe.get(w);
  if (!re) {
    re = new RegExp(`(?<![a-z0-9])${escapeRe(w)}(?![a-z0-9])`);
    asciiRe.set(w, re);
  }
  return re.test(haystack);
}

function firstIndex(haystack: string, word: string): number {
  const w = word.toLowerCase().trim();
  if (!w) return -1;
  if (!isAscii(w)) return haystack.indexOf(w);
  const m = new RegExp(`(?<![a-z0-9])${escapeRe(w)}(?![a-z0-9])`).exec(haystack);
  return m ? m.index : -1;
}

function excerptAround(text: string, at: number, width = EXCERPT_WIDTH): string {
  const flat = text.replace(/\s*\n+\s*/g, " ").trim();
  if (flat.length <= width) return flat;
  const start = Math.max(0, Math.min(at - Math.floor(width / 4), flat.length - width));
  const end = Math.min(flat.length, start + width);
  return (start > 0 ? "…" : "") + flat.slice(start, end).trim() + (end < flat.length ? "…" : "");
}

/** 这段文字命中了哪些主题的哪些关键词。heading 一起参与匹配（标题往往就是主题名）。 */
export function matchTopics(text: string, heading = ""): { topic: TopicSpec; keywords: string[]; at: number }[] {
  const hay = `${heading ?? ""}\n${text ?? ""}`.toLowerCase();
  const out: { topic: TopicSpec; keywords: string[]; at: number }[] = [];
  for (const topic of TOPICS) {
    const words: string[] = [];
    let at = -1;
    for (const k of topic.satisfiedBy.keywords) {
      if (!contains(hay, k)) continue;
      words.push(k);
      const i = firstIndex(hay, k);
      if (i >= 0 && (at < 0 || i < at)) at = i;
    }
    if (words.length) out.push({ topic, keywords: words, at: Math.max(0, at - (heading?.length ?? 0) - 1) });
  }
  return out;
}

/** 只要主题 id，给检索侧用（搜索结果要顺着挂关联标签） */
export function topicIdsForText(text: string, heading = ""): string[] {
  return matchTopics(text, heading).map((m) => m.topic.id);
}

/** 把文档 + 切片挂到骨架上。docs 只用来取标题，chunks 才是判据来源。 */
export function buildGraph(docs: GraphDoc[], chunks: GraphChunk[]): KnowledgeGraph {
  const titleOf = new Map((docs ?? []).map((d) => [d.id, d.title]));
  const acc = new Map<string, TopicMatch[]>();
  for (const t of TOPICS) acc.set(t.id, []);

  for (const c of chunks ?? []) {
    if (!c || typeof c.text !== "string") continue;
    const heading = c.heading ?? "";
    for (const m of matchTopics(c.text, heading)) {
      acc.get(m.topic.id)!.push({
        docId: c.docId,
        title: titleOf.get(c.docId) ?? c.docId,
        chunkId: c.id,
        heading,
        excerpt: excerptAround(c.text, m.at),
        keywords: m.keywords,
      });
    }
  }

  const coverage: TopicCoverage[] = TOPICS.map((topic) => {
    const matches = acc.get(topic.id)!;
    const need = topic.satisfiedBy.minChunks ?? 1;
    return {
      topic,
      matches,
      chunkIds: matches.map((m) => m.chunkId),
      docIds: [...new Set(matches.map((m) => m.docId))],
      hits: matches.length,
      satisfied: matches.length >= need,
    };
  });

  // 边直接取 RELATIONS 的声明方向与类型（taxonomy 里每对只声明一次），
  // 不从 relatedTo 反推——反推会把同一对算两次（一次 prerequisite、一次 downstream）。
  const edges: TopicEdge[] = RELATIONS.map((r) => ({ from: r.from, to: r.to, kind: r.kind }));

  const satisfied = coverage.filter((c) => c.satisfied).length;
  const required = coverage.filter((c) => c.topic.required);
  return {
    coverage,
    edges,
    total: coverage.length,
    satisfied,
    requiredTotal: required.length,
    requiredSatisfied: required.filter((c) => c.satisfied).length,
  };
}

/** 空图：网页版 / 还没导过文档时用，省得调用方到处判 null */
export function emptyGraph(): KnowledgeGraph {
  return buildGraph([], []);
}

export function coverageOf(graph: KnowledgeGraph, topicId: string): TopicCoverage | undefined {
  return graph.coverage.find((c) => c.topic.id === topicId);
}

/**
 * 顺着关联往外走 depth 层，返回沿途主题（不含自己）。depth ≤ 0 返回空。
 * 默认 1 层——两层就已经能扯到半个知识体系，对「顺着查」没帮助反而是噪音。
 */
export function relatedTopics(topicId: string, depth = 1): TopicSpec[] {
  if (!topicById(topicId) || depth <= 0) return [];
  const seen = new Set<string>([topicId]);
  let frontier = [topicId];
  const out: TopicSpec[] = [];
  for (let d = 0; d < depth; d++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const r of relationsOf(id)) {
        if (seen.has(r.topic.id)) continue;
        seen.add(r.topic.id);
        out.push(r.topic);
        next.push(r.topic.id);
      }
    }
    if (!next.length) break;
    frontier = next;
  }
  return out;
}

/** 这条主题被哪些文档的哪些段落覆盖了——面板展开时显示，点一条就能看到原文 */
export function docsForTopic(
  topicId: string,
  graph: KnowledgeGraph,
): { docId: string; title: string; chunkId: string; excerpt: string }[] {
  const cov = coverageOf(graph, topicId);
  if (!cov) return [];
  return cov.matches.map((m) => ({ docId: m.docId, title: m.title, chunkId: m.chunkId, excerpt: m.excerpt }));
}
