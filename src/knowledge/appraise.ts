// 文档摘要与评价：导入时顺手给每份文档判个「有多大用」，不调模型，全靠规则 + 统计。
//
// 「评价」在这里不是「写得好不好」，是三件事：
//   1) 这份文档命中了知识体系（taxonomy.ts）里哪几条必备主题 —— 复用 graph.ts 的关键词判定，
//      跟「体系」面板用的是同一套判据，不会出现「面板说没覆盖、这里说覆盖了」的自相矛盾。
//   2) 缺了哪条 —— 只从文档自己所属分类的必备主题里找缺的，不跨类瞎报。
//   3) 文档本身靠不靠谱 —— 有没有数字、有没有步骤、有没有写清「找谁」、有没有生效日期，
//      这些是能读出来的客观信号，不是主观判断。
//
// 纯函数、零 IO：喂 title + chunks，吐一个 DocAppraisal。不 import ingest.ts（避免循环依赖，
// ingest.ts 要反过来 import 这个文件），首句提取等小工具在这里自己写一份，不算重复劳动。

import { majorityCategory, type CategoryId } from "./classify";
import { matchTopics } from "./graph";
import { topicsByCategory, type TopicSpec } from "./taxonomy";

export interface AppraiseChunk {
  heading?: string;
  text: string;
  category: string;
}

export interface DocAppraisal {
  summary: string;
  outline: { heading: string; gist: string }[];
  topicsCovered: { topicId: string; name: string; hits: number }[];
  categories: { id: string; name: string; ratio: number }[];
  usefulness: 1 | 2 | 3 | 4 | 5;
  usefulnessWhy: string;
  missing: string[];
  quality: {
    hasNumbers: boolean;
    hasSteps: boolean;
    hasOwners: boolean;
    hasDates: boolean;
    warnings: string[];
  };
  readingTime: number;
}

/** 去 Markdown 记号、取第一句话；chunk.ts 切出来的块可能带 #/-/数字序号前缀 */
function firstSentence(text: string, maxLen = 60): string {
  const flat = String(text ?? "")
    .split("\n")
    .map((l) => l.replace(/^\s*[#>*\-+]+\s*/, "").replace(/^\s*\d+[.、)]\s*/, "").replace(/[|*`]/g, "").trim())
    .filter(Boolean)
    .join("");
  const m = flat.match(/^[^。！？!?\n]{1,200}[。！？!?]?/);
  const s = (m?.[0] ?? flat.slice(0, maxLen)).trim();
  return s.length > maxLen ? `${s.slice(0, maxLen - 1)}…` : s;
}

/** why 字段的第一个分句（到第一个「，」「；」为止），missing 提示引用它，具体到「后果」而不是空话 */
function firstClause(text: string): string {
  const m = String(text ?? "").match(/^[^，,；;。]+/);
  return (m?.[0] ?? text).trim();
}

const CATEGORY_LABEL: Record<string, string> = {
  basics: "岗位基础", u8: "系统操作(U8)", ordering: "下单与算量", supplier: "供应商与商务",
  inbound: "到货与入库", finance: "对账与付款", collab: "跨部门协作", policy: "公司制度流程",
  material: "物料与技术", other: "其他",
};
const labelOf = (id: string) => CATEGORY_LABEL[id] ?? "其他";

/** 数字必须挂着账期/额度/天数一类的单位才算「具体数字」，光一个「3」说明不了什么 */
const NUMBER_RE = /\d+(\.\d+)?\s*(天|日|个工作日|周|月|年|%|％|元|万元|块|人民币|¥|￥|折|批|箱|件|条|次|个|份|号|页|版)/;
/** 有序步骤：「第一步」「首先…然后…」这类连接词（不挑位置），或列表项要求出现在行首（避免「3.5元」也算一步） */
const STEP_RE = /第[一二三四五六七八九十\d]+步|步骤\s*[一二三四五六七八九十\d]|首先.{0,40}(然后|接着|再|最后)|(^|\n)\s*(\d+[.、)]|[一二三四五六七八九十]+[、.])\s*\S/;
/** 找谁：责任人/部门/岗位一类的落点 */
const OWNER_RE = /负责人|责任人|联系人|对接人|找(仓管|财务|品质|计划|技术|主管|经理|专员|系统管理员|hr)|由.{0,6}(负责|审批|审核)|(仓管|财务部|品质部|计划部|技术部|采购部|hr)(负责|审批|确认)/i;
/** 生效日期/版本号：给这份文档一个「有没有过期」的锚点 */
const DATE_RE = /生效日期|发布日期|颁布日期|修订日期|实施日期|版本\s*[:：]?\s*v?\d|v\d+(\.\d+)*|第?\s*\d+\s*版|\d{4}\s*[-/年.]\s*\d{1,2}\s*[-/月.]?\s*\d{0,2}\s*日?/i;
/** 看起来是正式制度/流程类文件——缺日期才值得警告，一份话术卡不需要生效日期 */
const FORMAL_DOC_RE = /制度|办法|规范|流程|规程|细则|准则|手册|规定/;
/** 表格化文本的标记（rowsToText 的输出形状：「列名: 值 | 列名: 值」），避免被误判成 OCR 碎片 */
const TABLE_LIKE_RE = /:\s*\S+\s*\|/;

function pickTopN<T>(arr: T[], n: number): T[] {
  return arr.slice(0, Math.max(0, n));
}

/** 有用度：主要看命中了多少条「必备」主题（跨全部分类统计，不局限于文档自己的分类） */
function usefulnessOf(requiredHits: number): 1 | 2 | 3 | 4 | 5 {
  if (requiredHits <= 0) return 1;
  if (requiredHits <= 2) return 2;
  if (requiredHits <= 5) return 3;
  if (requiredHits <= 9) return 4;
  return 5;
}

export function appraiseDoc(input: { title: string; chunks: AppraiseChunk[] }): DocAppraisal {
  const title = String(input?.title ?? "").trim();
  const chunks = (input?.chunks ?? []).filter((c) => c && typeof c.text === "string");
  const fullText = chunks.map((c) => c.text).join("\n\n");
  // 用原始切片长度之和算「内容有多少」，不把拼接用的分隔符算进去，
  // 否则分类占比加总、按字数估的阅读时间都会因为块数多而悄悄跑偏。
  const totalLen = chunks.reduce((s, c) => s + c.text.length, 0);

  // ---------- 大纲：取切片自己的 heading + 首句，最多 8 条；块多就等距抽样，块少几条就是几条 ----------
  const withText = chunks.filter((c) => c.text.trim());
  const outline: { heading: string; gist: string }[] = [];
  if (withText.length) {
    const count = Math.min(8, withText.length);
    const stride = withText.length > count ? withText.length / count : 1;
    for (let i = 0; i < count; i++) {
      const idx = Math.min(withText.length - 1, Math.round(i * stride));
      const c = withText[idx];
      const heading = (c.heading ?? "").split(" > ").pop()?.trim() || title || "正文";
      outline.push({ heading, gist: firstSentence(c.text) });
    }
  }

  // ---------- 分类分布：按字符数占比，而不是块数——一段长正文比十个表头更能代表内容 ----------
  const catLen = new Map<string, number>();
  for (const c of chunks) catLen.set(c.category, (catLen.get(c.category) ?? 0) + c.text.length);
  const categories = [...catLen.entries()]
    .map(([id, len]) => ({ id, name: labelOf(id), ratio: totalLen ? len / totalLen : 0 }))
    .sort((a, b) => b.ratio - a.ratio);

  // ---------- 命中的主题：复用 graph.ts 的关键词判据，跟「体系」面板同一套口径 ----------
  // 每个切片只跑一次 matchTopics，顺手把 topic 对象、命中的切片数都记下来，后面不用重查。
  const hitTopics = new Map<string, { topic: TopicSpec; chunkIdx: Set<number> }>();
  chunks.forEach((c, i) => {
    for (const m of matchTopics(c.text, c.heading ?? "")) {
      const entry = hitTopics.get(m.topic.id) ?? { topic: m.topic, chunkIdx: new Set<number>() };
      entry.chunkIdx.add(i);
      hitTopics.set(m.topic.id, entry);
    }
  });
  const topicsCoveredFinal = [...hitTopics.values()]
    .map(({ topic, chunkIdx }) => ({ topicId: topic.id, name: topic.name, hits: chunkIdx.size }))
    .sort((a, b) => b.hits - a.hits || a.topicId.localeCompare(b.topicId));

  const requiredHitTopics: TopicSpec[] = [...hitTopics.values()]
    .map((e) => e.topic)
    .filter((t) => t.required)
    .sort((a, b) => a.id.localeCompare(b.id));

  const usefulness = usefulnessOf(requiredHitTopics.length);

  // ---------- 质量信号 ----------
  const hasNumbers = NUMBER_RE.test(fullText);
  const hasSteps = STEP_RE.test(fullText);
  const hasOwners = OWNER_RE.test(fullText);
  const hasDates = DATE_RE.test(fullText);
  const looksFormal = FORMAL_DOC_RE.test(title) || chunks.some((c) => c.heading && FORMAL_DOC_RE.test(c.heading));
  const isTableLike = TABLE_LIKE_RE.test(fullText);

  const warnings: string[] = [];
  if (totalLen < 120) {
    warnings.push("正文内容很少，可能只是提纲或者还没写完，先当框架看，别当完整制度用。");
  } else if (!hasNumbers && ["ordering", "finance", "u8", "inbound", "material"].some((c) => (catLen.get(c) ?? 0) > 0)) {
    warnings.push("通篇没有具体数字，账期/额度/天数这些口径还得另外找，只能当框架看。");
  }
  if (looksFormal && !hasDates) {
    warnings.push("没有找到生效日期或版本号，不确定是不是最新版本，用之前最好找人确认一下。");
  }
  if (!isTableLike && totalLen > 0 && totalLen < 500) {
    const lines = fullText.split("\n").map((l) => l.trim()).filter(Boolean);
    const avgLineLen = lines.length ? lines.reduce((s, l) => s + l.length, 0) / lines.length : 0;
    const punct = (fullText.match(/[。！？，、；]/g) ?? []).length;
    if (lines.length >= 3 && avgLineLen < 10 && punct / Math.max(1, totalLen) < 0.02) {
      warnings.push("文字比较破碎、标点很少，读起来像扫描件识别出来的，留意有没有认错字、漏字。");
    }
  }

  // ---------- 缺什么：只从文档自己所属分类的必备主题里找 ----------
  const docCategory = chunks.length
    ? majorityCategory(chunks.map((c) => ({ category: c.category as CategoryId })))
    : ("other" as CategoryId);
  const covered = new Set(topicsCoveredFinal.map((t) => t.topicId));
  const missingTopics = topicsByCategory(docCategory).filter((t) => t.required && !covered.has(t.id));
  const missing = missingTopics.map((t) => `没写「${t.name}」——${firstClause(t.why)}。`);

  // ---------- 有用度的一句话解释：必须能核对，列出命中的必备主题名字 ----------
  // 注意：taxonomy 里个别主题名字本身带全角括号（如「三单匹配（订单-入库-发票）」），
  // 所以这句话不能再用外层括号包主题列表，改用冒号 + 分号分段，两边都不会互相嵌套混淆。
  const namedHits = pickTopN(requiredHitTopics.map((t) => t.name), 5);
  const numberNote = hasNumbers ? "且含具体数字（账期/额度/天数一类）" : "但没有具体数字";
  const usefulnessWhy =
    requiredHitTopics.length === 0
      ? `没有命中任何必备主题${hasNumbers ? "，虽然有具体数字" : ""}，当参考资料的价值有限。`
      : `命中 ${requiredHitTopics.length} 条必备主题：${namedHits.join("、")}${requiredHitTopics.length > namedHits.length ? "等" : ""}；${numberNote}。`;

  // ---------- 摘要：讲清楚「这份文档讲什么、覆盖哪些环节、适合什么时候查」，不是首句拼接 ----------
  const topCats = pickTopN(categories.filter((c) => c.ratio > 0), 2).map((c) => c.name);
  const topTopicNames = pickTopN(topicsCoveredFinal.map((t) => t.name), 4);
  const whenToCheck = topCats.length
    ? `适合在涉及${topCats.join("、")}相关工作时对照着查`
    : "内容还太少，暂时只能当草稿参考";

  let summary: string;
  if (!title && !totalLen) {
    summary = "这是一份空文档，没有可读的正文内容，谈不上摘要。";
  } else if (totalLen < 60) {
    summary = `《${title || "未命名文档"}》${topCats.length ? `属于「${topCats.join("、")}」范畴，` : ""}但正文只有寥寥数语，看不出完整内容，建议核实原文件是否完整。`;
  } else {
    const openPart = `《${title || "未命名文档"}》主要讲的是${topCats.length ? `「${topCats.join("」「")}」这块内容` : "还没能识别出明确分类的内容"}`;
    const topicPart = topTopicNames.length ? `，覆盖了${topTopicNames.join("、")}等环节` : "，但没有明显对上知识体系里的具体主题";
    const gapPart = missing.length
      ? `；缺的是${missingTopics.slice(0, 2).map((t) => t.name).join("、")}这一类，查的时候要留意`
      : missingTopics.length === 0 && docCategory !== "other"
        ? "；该分类下的必备主题基本都有覆盖"
        : "";
    summary = `${openPart}${topicPart}${gapPart}，${whenToCheck}。`;
  }
  if (summary.length > 220) summary = `${summary.slice(0, 219)}…`;

  const readingTime = Math.max(1, Math.round(totalLen / 400));

  return {
    summary,
    outline,
    topicsCovered: topicsCoveredFinal,
    categories,
    usefulness,
    usefulnessWhy,
    missing,
    quality: { hasNumbers, hasSteps, hasOwners, hasDates, warnings },
    readingTime,
  };
}
