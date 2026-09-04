// 缺口提醒：知识库缺哪条、有多要紧、下一步具体去做什么。
//
// 写这个文件时守两条：
//   1) 只报「缺了会出事」的（must），其余归 should。四十条全标红等于一条都没报——用户会直接把提醒关掉。
//   2) 每条给的是一个动作，不是一句正确的废话。「建议补充相关资料」这种话在这里是 bug，
//      taxonomy 的 askIfMissing 必须写清「去要哪份文件、找谁要」，下面的 BANNED_PHRASES 会在测试里把它挡住。
//   3) 缺口 ≠ 空白。公司文档没有的主题，多数在 fallback.ts 里有一份行业通用口径可以先看，
//      所以每条缺口都挂上 fallback，汇总时把「有通用版顶着」和「真空白」分开报——
//      前者是「今天就能上手」，后者才是需要去要文件的。

import { CATEGORIES, categoryName } from "./classify";
import { coverageWithFallback, fallbackFor, type FallbackNote } from "./fallback";
import { coverageOf, type KnowledgeGraph } from "./graph";
import { relationsOf, type TopicSpec } from "./taxonomy";

export type GapSeverity = "must" | "should";

export interface KnowledgeGap {
  topic: TopicSpec;
  severity: GapSeverity;
  /** 给用户看的一句人话，具体到「去要哪份文件、找谁要」 */
  ask: string;
  /** 当前命中的切片数（0 = 一个字都没有；>0 = 有但不够厚） */
  hits: number;
  /** 判据要求的切片数 */
  need: number;
  /** 顺带能补齐的主题：通常写在同一份文件里，一次要齐比要三次省事 */
  alsoCovers: TopicSpec[];
  /** 公司文档还没有，但有一份行业通用口径可以先看（见 fallback.ts） */
  fallback?: FallbackNote;
  /** 等价于 fallback !== undefined，给 UI 少写一次判空 */
  hasFallback: boolean;
}

/** 这些词出现在 ask 里就是没说人话，测试会拦。 */
export const BANNED_PHRASES = [
  "建议补充相关资料",
  "建议补充相关内容",
  "请补充相关",
  "完善知识库",
  "丰富知识库",
  "补充相关资料",
  "相关文档",
  "适当补充",
];

const CATEGORY_ORDER = new Map(CATEGORIES.map((c, i) => [c.id as string, i]));
const SEVERITY_ORDER: Record<GapSeverity, number> = { must: 0, should: 1 };

/** 部分覆盖时，把「已经有几段、还差几段」讲在前面，后面接原本那句具体动作 */
function askFor(topic: TopicSpec, hits: number, need: number): string {
  if (hits <= 0) return topic.askIfMissing;
  return `「${topic.name}」目前只有 ${hits} 段零星提到（要算数得有 ${need} 段以上）——${topic.askIfMissing}`;
}

/**
 * 找出所有没达标的主题。
 * must  = 必备主题且一个字都没有；
 * should = 必备但只写了一半，或非必备缺失。
 * 排序：must 在前，同级按分类顺序，再按命中数少的在前（越空的越该先补）。
 */
export function findGaps(graph: KnowledgeGraph): KnowledgeGap[] {
  const gaps: KnowledgeGap[] = [];
  for (const cov of graph.coverage) {
    if (cov.satisfied) continue;
    const topic = cov.topic;
    const need = topic.satisfiedBy.minChunks ?? 1;
    const severity: GapSeverity = topic.required && cov.hits === 0 ? "must" : "should";
    const alsoCovers = relationsOf(topic.id)
      .filter((r) => r.kind === "same-doc")
      .map((r) => r.topic)
      .filter((t) => !coverageOf(graph, t.id)?.satisfied);
    const fallback = fallbackFor(topic.id);
    gaps.push({
      topic,
      severity,
      ask: askFor(topic, cov.hits, need),
      hits: cov.hits,
      need,
      alsoCovers,
      fallback,
      hasFallback: fallback !== undefined,
    });
  }
  return gaps.sort((a, b) => {
    const s = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    if (s) return s;
    const c = (CATEGORY_ORDER.get(a.topic.category) ?? 99) - (CATEGORY_ORDER.get(b.topic.category) ?? 99);
    if (c) return c;
    return a.hits - b.hits;
  });
}

/** 面板顶部只放最紧要的几条，默认 3 条；不足则用 should 里最靠前的补齐 */
export function topGaps(graph: KnowledgeGraph, n = 3): KnowledgeGap[] {
  return findGaps(graph).slice(0, Math.max(0, n));
}

export interface GapSummary {
  requiredSatisfied: number;
  requiredTotal: number;
  mustCount: number;
  shouldCount: number;
  /** 一句话进度，直接显示在面板顶部 */
  headline: string;
  /** 必备主题里，你自己的文档已经覆盖的条数 */
  covered: number;
  /** 必备主题里，公司文档还没有、但有通用兜底可看的条数 */
  fallbackOnly: number;
  /** 必备主题里，既没有文档也没有兜底的条数——只有这些才真叫空白 */
  bare: number;
  /**
   * 给用户看的一句人话。口径：兜底不是欠账，是「先有通用版可用，补了公司版更准」，
   * 所以先报覆盖、再报有通用口径顶着、最后才提真正空白的那几条。
   */
  message: string;
}

export function gapSummary(graph: KnowledgeGraph): GapSummary {
  const gaps = findGaps(graph);
  const mustCount = gaps.filter((g) => g.severity === "must").length;
  const shouldCount = gaps.length - mustCount;
  const { requiredSatisfied, requiredTotal } = graph;
  const headline =
    requiredTotal === 0
      ? "还没有定义必备主题"
      : mustCount === 0
        ? `必备主题覆盖 ${requiredSatisfied}/${requiredTotal}，必备项已经齐了`
        : `必备主题覆盖 ${requiredSatisfied}/${requiredTotal}，还差 ${mustCount} 条关键的`;

  // 三个数只算必备主题，且互斥：已覆盖 / 有通用兜底 / 真空白，加起来 = requiredTotal。
  const requiredGaps = gaps.filter((g) => g.topic.required);
  const { withFallback, bare } = coverageWithFallback(requiredGaps);
  const covered = requiredSatisfied;
  return {
    requiredSatisfied,
    requiredTotal,
    mustCount,
    shouldCount,
    headline,
    covered,
    fallbackOnly: withFallback,
    bare,
    message: summaryMessage(covered, withFallback, bare, requiredTotal),
  };
}

/** 一句人话。语气：兜底是「先有得看」，不是「你欠了 21 条债」。 */
function summaryMessage(covered: number, fallbackOnly: number, bare: number, total: number): string {
  if (total === 0) return "还没有定义必备主题，先把 taxonomy 的必备项定下来。";
  const parts = [`必备主题 ${total} 条：你的文档覆盖 ${covered} 条`];
  if (fallbackOnly > 0) parts.push(`另外 ${fallbackOnly} 条先用通用口径顶着（点开就能看）`);
  if (bare > 0) parts.push(`完全空白 ${bare} 条`);
  else if (fallbackOnly > 0) parts.push("没有一条是完全空白的");
  const body = parts.join("，");
  if (covered === total) return `${body}。公司口径已经齐了，接下来是把它们越写越准。`;
  if (fallbackOnly > 0) return `${body}。通用口径能让你今天就上手，补进公司文档之后会更准。`;
  return `${body}。`;
}

/** 按分类汇总缺口数，给「体系」视图的分类头显示 */
export function gapsByCategory(graph: KnowledgeGraph): Map<string, { must: number; should: number; label: string }> {
  const out = new Map<string, { must: number; should: number; label: string }>();
  for (const g of findGaps(graph)) {
    const cur = out.get(g.topic.category) ?? { must: 0, should: 0, label: categoryName(g.topic.category) };
    if (g.severity === "must") cur.must++;
    else cur.should++;
    out.set(g.topic.category, cur);
  }
  return out;
}
