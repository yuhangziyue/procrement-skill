// 把一段文本归到采购知识的 10 个分类里。纯关键词加权打分，不调模型——
// 导入时每块都要跑一遍，走 LLM 又慢又贵，而且采购这套词汇很封闭，规则表足够用。
//
// 打分规则：
//   命中一个关键词 = 权重 × 出现次数（次数上限 3，防一个词刷满分）；标题里命中额外再加一份权重（标题是强信号）。
//   取最高分的类；最高分低于 MIN_SCORE 落到 other。
// 权重口径：3 = 这个词基本只在该类出现（U8 / MOQ / 对账单）；2 = 偏向该类；1 = 弱相关，只做加权。

export type CategoryId =
  | "basics" | "u8" | "ordering" | "supplier" | "inbound"
  | "finance" | "collab" | "policy" | "material" | "other";

export interface Category {
  id: CategoryId;
  name: string;
  desc: string;
}

export const CATEGORIES: Category[] = [
  { id: "basics", name: "岗位基础", desc: "采购术语、5R、QCDS、三单匹配、职责边界" },
  { id: "u8", name: "系统操作(U8)", desc: "用友 U8 菜单、单据、报表、导入导出" },
  { id: "ordering", name: "下单与算量", desc: "缺料计算、MOQ、包装凑整、交期倒推、请购/采购订单" },
  { id: "supplier", name: "供应商与商务", desc: "寻源、报价、比价、议价、合同、账期、考核" },
  { id: "inbound", name: "到货与入库", desc: "到货预告、验收、质检、入库、退换货" },
  { id: "finance", name: "对账与付款", desc: "对账单、发票、税率、付款申请、暂估" },
  { id: "collab", name: "跨部门协作", desc: "与生产/计划/仓库/品质/财务的接口与话术" },
  { id: "policy", name: "公司制度流程", desc: "审批权限、廉洁红线、供应商准入、内控" },
  { id: "material", name: "物料与技术", desc: "物料编码、规格书、替代料、BOM" },
  { id: "other", name: "其他", desc: "没有明显归属的内容" },
];

const NAME_BY_ID = new Map(CATEGORIES.map((c) => [c.id, c.name]));
export const categoryName = (id: string): string => NAME_BY_ID.get(id as CategoryId) ?? "其他";
export const isCategoryId = (id: string): id is CategoryId => NAME_BY_ID.has(id as CategoryId);

/** 低于这个分 ⇒ other。相当于「至少命中一个强词，或两个中等词」 */
export const MIN_SCORE = 3;
/** 同一个词最多按 3 次算 */
const MAX_HITS_PER_WORD = 3;

type Vocab = Record<Exclude<CategoryId, "other">, [string, number][]>;

// 词表刻意写得啰嗦、可读，出错时直接改这里；不要塞进正则。
const VOCAB: Vocab = {
  basics: [
    ["5r", 3], ["qcds", 3], ["三单匹配", 3], ["采购术语", 3], ["岗位职责", 3], ["职责边界", 3],
    ["质量成本交期服务", 3], ["采购闭环", 3], ["名词解释", 3], ["基础知识", 2], ["入门", 2],
    ["采购专员", 2], ["采购员", 2], ["采购新人", 2], ["带教", 2], ["缩写", 2], ["基本概念", 2],
    ["合适的数量", 2], ["合适的价格", 2], ["合适的时间", 2], ["采购的价值", 2], ["工作职责", 2],
    ["日常工作", 1], ["什么是", 1], ["定义", 1], ["扫盲", 2], ["采购是做什么", 3],
  ],
  u8: [
    ["u8", 3], ["用友", 3], ["yonsuite", 3], ["erp", 3], ["账套", 3], ["菜单路径", 3],
    ["参照生成", 3], ["参照订单", 3], ["弃审", 3], ["表体", 3], ["表头", 2], ["现存量查询", 3],
    ["基础档案", 3], ["存货档案", 3], ["系统管理", 2], ["业务工作", 2], ["供应链", 1],
    ["单据编号", 2], ["红字单据", 3], ["生单", 2], ["审核单据", 2], ["导出报表", 2],
    ["登录系统", 2], ["系统里", 2], ["点保存", 2], ["界面", 1], ["按钮", 1], ["模块", 1],
  ],
  ordering: [
    ["缺料", 3], ["缺料计算", 3], ["moq", 3], ["起订量", 3], ["凑整", 3], ["交期倒推", 3],
    ["最晚下单日", 3], ["请购单", 3], ["采购订单", 3], ["净需求", 3], ["毛需求", 3], ["提前期", 3],
    ["lead time", 3], ["下单量", 3], ["订购数量", 3], ["下单", 3], ["加单", 3], ["补单", 2],
    ["急单", 2], ["包装规格", 2], ["包装数", 2], ["需求数量", 2], ["安全库存", 2], ["用量", 2],
    ["分批到货", 2], ["批量", 1], ["排产", 2], ["请购", 3],
  ],
  supplier: [
    ["供应商", 3], ["寻源", 3], ["询价", 3], ["报价", 3], ["比价", 3], ["议价", 3], ["谈判", 3],
    ["招标", 3], ["报价单", 3], ["商务条款", 3], ["开发供应商", 3], ["备选供应商", 3], ["二供", 3],
    ["合同", 3], ["账期", 3], ["降本", 3], ["年降", 3], ["付款条款", 2], ["考核", 2], ["绩效", 2],
    ["打样", 2], ["签样", 2], ["厂家", 2], ["交货能力", 2], ["独家", 1], ["有效期", 1],
  ],
  inbound: [
    ["到货", 3], ["到货预告", 3], ["验收", 3], ["质检", 3], ["报检", 3], ["入库", 3], ["入库单", 3],
    ["收货", 3], ["退货", 3], ["来料", 3], ["拒收", 3], ["iqc", 3], ["送货单", 3], ["到货计划", 2],
    ["换货", 2], ["卸货", 2], ["欠交", 2], ["超交", 2], ["检验", 2], ["随货", 2], ["码单", 2],
    ["到货数量", 2], ["入库数量", 2], ["暂收", 2], ["点数", 2], ["签收", 3],
  ],
  finance: [
    ["对账", 3], ["对账单", 3], ["发票", 3], ["税率", 3], ["含税", 3], ["付款申请", 3], ["暂估", 3],
    ["应付", 3], ["结算", 3], ["开票", 3], ["专票", 3], ["普票", 3], ["请款", 3], ["核销", 3],
    ["价税合计", 3], ["付款", 3], ["月结", 2], ["报销", 2], ["财务", 2], ["票据", 2], ["未税", 2],
    ["金额差异", 2], ["挂账", 3], ["回款", 2],
  ],
  collab: [
    ["跨部门", 3], ["话术", 3], ["对接", 3], ["协调", 3], ["接口人", 3], ["上下游部门", 3],
    ["扯皮", 3], ["推诿", 3], ["生产部", 2], ["计划部", 2], ["品质部", 2], ["财务部", 2],
    ["仓管", 2], ["车间", 2], ["知会", 2], ["抄送", 2], ["同步给", 2], ["反馈给", 2],
    ["请教", 2], ["求助", 2], ["配合", 2], ["沟通", 2], ["协作", 2], ["汇报", 2], ["开口", 2],
  ],
  policy: [
    ["制度", 3], ["流程规范", 3], ["审批权限", 3], ["廉洁", 3], ["红线", 3], ["回扣", 3],
    ["利益冲突", 3], ["供应商准入", 3], ["准入", 3], ["内控", 3], ["合规", 3], ["保密", 3],
    ["权限矩阵", 3], ["违规", 3], ["公司规定", 3], ["管理办法", 3], ["审计", 3], ["职业操守", 3],
    ["审批", 2], ["授权", 2], ["签批", 2], ["处罚", 2], ["留痕", 2], ["备案", 2], ["禁止", 2],
  ],
  material: [
    ["物料编码", 3], ["存货编码", 3], ["规格书", 3], ["替代料", 3], ["bom", 3], ["图纸", 3],
    ["技术参数", 3], ["材质", 3], ["承认书", 3], ["料号", 3], ["ecn", 3], ["工程变更", 3],
    ["编码规则", 3], ["物料属性", 3], ["物性表", 2], ["单位换算", 2], ["计量单位", 2],
    ["型号", 2], ["规格", 2], ["品名", 2], ["新料", 2], ["主料", 2], ["辅料", 2], ["物料", 2],
  ],
};

/** 纯 ASCII 词要加边界，否则 bom 会命中 bomb、u8 会命中 u80 */
const isAscii = (w: string) => /^[\x20-\x7e]+$/.test(w);
const escapeRe = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const asciiRe = new Map<string, RegExp>();
function countWord(haystack: string, word: string): number {
  if (isAscii(word)) {
    let re = asciiRe.get(word);
    if (!re) {
      re = new RegExp(`(?<![a-z0-9])${escapeRe(word)}(?![a-z0-9])`, "g");
      asciiRe.set(word, re);
    }
    re.lastIndex = 0;
    return (haystack.match(re) ?? []).length;
  }
  let n = 0;
  let i = haystack.indexOf(word);
  while (i >= 0) {
    n++;
    i = haystack.indexOf(word, i + word.length);
  }
  return n;
}

export interface ClassifyHit {
  word: string;
  weight: number;
  count: number;
  /** 是否命中在标题上（标题命中额外加权） */
  inHeading: boolean;
}

export interface ClassifyResult {
  category: CategoryId;
  score: number;
  /** 命中的关键词，按贡献从大到小，最多 8 个，给 UI / 调试看 */
  hits: ClassifyHit[];
  /** 各类得分，调词表时看这个 */
  scores: Record<string, number>;
}

/** 给一段文本（可带标题）定分类。标题里的关键词按双倍权重算。 */
export function classify(text: string, heading = ""): ClassifyResult {
  const body = String(text ?? "").toLowerCase();
  const head = String(heading ?? "").toLowerCase();
  const scores: Record<string, number> = {};
  let best: CategoryId = "other";
  let bestScore = 0;
  let bestHits: ClassifyHit[] = [];

  for (const [id, words] of Object.entries(VOCAB) as [CategoryId, [string, number][]][]) {
    let score = 0;
    const hits: ClassifyHit[] = [];
    for (const [word, weight] of words) {
      const inBody = Math.min(countWord(body, word), MAX_HITS_PER_WORD);
      const inHead = Math.min(countWord(head, word), 1);
      if (!inBody && !inHead) continue;
      const gained = weight * inBody + weight * inHead * 2;
      score += gained;
      hits.push({ word, weight, count: inBody, inHeading: inHead > 0 });
    }
    scores[id] = score;
    if (score > bestScore) {
      bestScore = score;
      best = id;
      bestHits = hits;
    }
  }

  if (bestScore < MIN_SCORE) return { category: "other", score: bestScore, hits: [], scores };
  bestHits.sort((a, b) => b.weight * (b.count + (b.inHeading ? 2 : 0)) - a.weight * (a.count + (a.inHeading ? 2 : 0)));
  return { category: best, score: bestScore, hits: bestHits.slice(0, 8), scores };
}

/** 文档级分类 = 各块分类的众数（忽略 other；全是 other 才是 other）。同票时块多的、总分高的赢。 */
export function majorityCategory(items: { category: CategoryId; score?: number }[]): CategoryId {
  const tally = new Map<CategoryId, { n: number; score: number }>();
  for (const it of items) {
    if (it.category === "other") continue;
    const cur = tally.get(it.category) ?? { n: 0, score: 0 };
    cur.n++;
    cur.score += it.score ?? 0;
    tally.set(it.category, cur);
  }
  let best: CategoryId = "other";
  let bestN = 0;
  let bestScore = 0;
  for (const [id, v] of tally) {
    if (v.n > bestN || (v.n === bestN && v.score > bestScore)) {
      best = id;
      bestN = v.n;
      bestScore = v.score;
    }
  }
  return best;
}
