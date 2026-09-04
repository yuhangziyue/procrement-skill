// 知识库的「浏览维度」：把 taxonomy.ts 的 40 条主题按业务动作收进六个模块。
//
// 为什么不是 taxonomy 的 10 个 CategoryId：CategoryId 是分拣器的输出，是存储维度——
// 「这段文字归哪一类」；模块回答的是完全不同的问题——「我现在卡在哪个业务动作上，该去哪翻」。
// 两者互不干扰，靠这个文件单向映射，taxonomy.ts 一个字不改。
//
// 明确不设「系统操作 / U8」模块：u8.* 四条按业务动作拆进了 ①②④⑥。
// 她的检索起点是业务动作，不是系统功能——U8 教程本身已经是独立入口，
// 两个门通向同一片地只会让她每次都要猜走哪个。
//
// 前四个模块与看板泳道（src/board/types.ts 的 Stage）同名同色，方便她把「知识」和「今天的活」
// 对上号；⑤⑥ 是常驻的两块——钱和规矩不属于任何一个泳道阶段，但天天都用得上。

import type { TopicCoverage } from "./graph";
import { TOPICS } from "./taxonomy";

/** 与 src/board/types.ts 的 Stage 字面量保持一致（只读那份，这里单独写一份避免跨模块耦合） */
export type ModuleStage = "demand" | "to_order" | "transit" | "inbound";

export interface KnowledgeModule {
  id: string;
  name: string;
  /** 什么时候来这里翻——一句话，讲的是场景不是定义 */
  blurb: string;
  /** 前四个与泳道同名同色；⑤⑥ 不设，UI 落到中性色 */
  stage?: ModuleStage;
  /** 这个模块收哪些 taxonomy 主题；40 条全部归入，无遗漏无重复 */
  topicIds: string[];
}

export const MODULES: KnowledgeModule[] = [
  {
    id: "demand",
    name: "需求与算量",
    blurb: "算缺口、判断该买多少之前来这翻——可用量、净缺口、编码认不认得出，都在这。",
    stage: "demand",
    topicIds: [
      "ordering.available-qty",
      "ordering.net-shortage",
      "ordering.lead-time",
      "u8.stock-query",
      "material.code-rule",
      "material.uom",
      "material.substitute",
    ],
  },
  {
    id: "to_order",
    name: "下单与回签",
    blurb: "从算完缺口到拿到供应商书面回签，中间的比价、录单、审批口径，来这翻。",
    stage: "to_order",
    topicIds: [
      "ordering.moq",
      "ordering.pack-round",
      "ordering.requisition",
      "u8.po-entry",
      "supplier.quote-compare",
      "supplier.contract-terms",
      "policy.approval-matrix",
      "material.spec-sheet",
    ],
  },
  {
    id: "transit",
    name: "在途与催货",
    blurb: "已回签未到货，要盯进度、要催的时候来这翻——话术、计划接口、供应商底细都在这。",
    stage: "transit",
    topicIds: ["collab.chase-script", "collab.production-plan", "supplier.performance"],
  },
  {
    id: "inbound",
    name: "到货与入库",
    blurb: "货到了、要跟仓库和品质对接的时候来这翻——预告、验收、欠超交、入库过账都在这。",
    stage: "inbound",
    topicIds: [
      "inbound.arrival-notice",
      "inbound.arrival-record",
      "inbound.receipt-posting",
      "inbound.acceptance",
      "inbound.short-over",
      "collab.warehouse-handoff",
      "collab.quality-escalation",
      "u8.reference-generate",
    ],
  },
  {
    id: "money",
    name: "钱与票",
    blurb: "对账、开票、含税口径这些跟钱沾边的事，不管卡在哪个阶段，都来这翻。",
    topicIds: [
      "finance.tax-inclusive",
      "finance.reconciliation",
      "finance.invoice-payment",
      "finance.accrual",
      "supplier.payment-terms",
      "basics.three-way-match",
    ],
  },
  {
    id: "rules",
    name: "规矩与底线",
    blurb: "廉洁红线、审批权限、职责边界这些不常翻但一次错就是大事的东西，来这翻。",
    topicIds: [
      "policy.integrity",
      "policy.record-keeping",
      "policy.supplier-onboarding",
      "basics.role-boundary",
      "basics.5r",
      "u8.login-account",
      "other.glossary",
      "other.contacts",
    ],
  },
];

/** 建表时顺手校验：40 条主题全部归入、无遗漏无重复，模块 id 也不许重复。跟 taxonomy.ts 一个纪律。 */
function validate(): Map<string, KnowledgeModule> {
  const moduleIds = new Set<string>();
  const byTopic = new Map<string, KnowledgeModule>();
  for (const m of MODULES) {
    if (moduleIds.has(m.id)) throw new Error(`modules: 模块 id 重复「${m.id}」`);
    moduleIds.add(m.id);
    for (const topicId of m.topicIds) {
      if (byTopic.has(topicId)) {
        throw new Error(`modules: 主题「${topicId}」同时属于「${byTopic.get(topicId)!.id}」和「${m.id}」，模块划分要求互斥`);
      }
      byTopic.set(topicId, m);
    }
  }
  const allTopicIds = new Set(TOPICS.map((t) => t.id));
  for (const t of allTopicIds) {
    if (!byTopic.has(t)) throw new Error(`modules: 主题「${t}」没有归入任何模块`);
  }
  for (const id of byTopic.keys()) {
    if (!allTopicIds.has(id)) throw new Error(`modules: 模块里的主题「${id}」在 taxonomy.ts 里不存在`);
  }
  return byTopic;
}

const MODULE_BY_TOPIC = validate();

/** 某条主题属于哪个模块 */
export function moduleOf(topicId: string): KnowledgeModule | undefined {
  return MODULE_BY_TOPIC.get(topicId);
}

export interface ModuleProgress {
  done: number;
  total: number;
  /** 该模块内 required && 未覆盖的主题里，按 taxonomy 声明顺序排第一条的——最疼的那条 */
  worstGap?: { name: string; why: string };
}

/**
 * 模块首屏卡片要的三行数据。coverage 传 KnowledgeGraph.coverage（顺序即 taxonomy 声明顺序，
 * 这样「取第一条」天然就是「按 SEEDS 声明顺序取第一条」，不用额外排序。
 */
export function moduleProgress(moduleId: string, coverage: TopicCoverage[]): ModuleProgress {
  const mod = MODULES.find((m) => m.id === moduleId);
  if (!mod) return { done: 0, total: 0 };
  const ids = new Set(mod.topicIds);
  const rows = coverage.filter((c) => ids.has(c.topic.id));
  const done = rows.filter((c) => c.satisfied).length;
  const worst = rows.find((c) => c.topic.required && !c.satisfied);
  return {
    done,
    total: mod.topicIds.length,
    worstGap: worst ? { name: worst.topic.name, why: worst.topic.why } : undefined,
  };
}
