// 物料查询 + 采购状态判定（03 §场景1 第一步「先确认存货编码」+ 采购状态拦截的程序化版本）。
// 输入 = 物料表行（列名见 templates/material-list-template.csv），先按「存货编码」精确匹配，再按名称包含匹配（多命中全部返回）。
// 每条命中给 verdict + 一句话结论；未命中不猜，让人回去和生产核对编码。不碰 IO / DOM / db。

export type MaterialRowLike = Record<string, string>;

export interface LookupQuery {
  /** 存货编码（精确匹配，忽略首尾空格） */
  code?: string;
  /** 存货名称（包含匹配，忽略大小写与空格） */
  name?: string;
}

/**
 * ok            在购 / 在购-日配 → 可以下单
 * blocked       停购-* → 不下单，先反问生产是否真要复用旧包材
 * confirm_alive 在购-警示将下架 → 可下但先确认物料还活着、量放保守
 * need_source   按需-* → 必须有明确需求来源才下
 * ask_production 采购状态为空/不认识 → 状态不明，先问生产和物料管理员
 */
export type HitVerdict = "ok" | "blocked" | "ask_production" | "confirm_alive" | "need_source";
export type LookupVerdict = HitVerdict | "not_found" | "multiple";

export interface LookupHit {
  code: string;
  name: string;
  supplier: string;
  status: string;
  note: string;
  matchedBy: "code" | "name";
  verdict: HitVerdict;
  /** 日配料：每天都要到，交期按天排 */
  priority?: "daily";
  /** 一句话结论，原样展示给新人 */
  conclusion: string;
  row: MaterialRowLike;
}

export interface LookupResult {
  query: LookupQuery;
  /** 命中方式：code=编码精确；name=名称包含；none=未命中 */
  matchedBy: "code" | "name" | "none";
  hits: LookupHit[];
  /** 单命中=该命中的 verdict；多命中=multiple；未命中=not_found */
  verdict: LookupVerdict;
  headline: string;
  /** 全局提醒 */
  flags: string[];
}

const pick = (row: MaterialRowLike, keys: string[]) => {
  for (const k of keys) {
    const v = row[k];
    if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim();
  }
  return "";
};
const CODE_KEYS = ["存货编码", "物料编码", "编码"];
const NAME_KEYS = ["存货名称", "物料名称", "名称"];
const norm = (s: string) => s.replace(/\s+/g, "").toLowerCase();

/** 只看采购状态给结论（供其他工具复用） */
export function judgeStatus(status: string, name: string): { verdict: HitVerdict; priority?: "daily"; conclusion: string } {
  const s = status.trim();
  if (!s) return { verdict: "ask_production", conclusion: `❓ 「${name}」采购状态空白：状态不明不下单，先问生产和物料管理员这料现在买不买` };
  // 「在购-警示将下架」也含「下架」二字，必须先判警示再判停购
  if (/警示/.test(s)) return { verdict: "confirm_alive", conclusion: `⚠️ 「${name}」采购状态「${s}」：可下单，但先向生产确认物料还活着（是否即将改版/下架），量放保守，别一次下太多` };
  if (/停购|下架/.test(s)) return { verdict: "blocked", conclusion: `⛔ 「${name}」采购状态「${s}」：不下单。生产表命中停购料 → 先反问生产是否真要复用旧包材，书面确认后再谈` };
  if (/按需/.test(s)) return { verdict: "need_source", conclusion: `➡️ 「${name}」采购状态「${s}」：必须有明确需求来源（生产表 / 书面通知）才下，口头喊一嗓子不算` };
  if (/在购/.test(s)) {
    if (/日配/.test(s)) return { verdict: "ok", priority: "daily", conclusion: `✅ 「${name}」采购状态「${s}」：可以下单；日配料，每天都要到，交期按天排、库存别断` };
    return { verdict: "ok", conclusion: `✅ 「${name}」采购状态「${s}」：可以下单，接着算净缺口和交期倒推` };
  }
  return { verdict: "ask_production", conclusion: `❓ 「${name}」采购状态「${s}」不在枚举里（在购/在购-日配/在购-警示将下架/按需/停购-长期不买/停购-已下架）：先问物料管理员这是什么状态` };
}

function toHit(row: MaterialRowLike, matchedBy: "code" | "name"): LookupHit {
  const code = pick(row, CODE_KEYS);
  const name = pick(row, NAME_KEYS);
  const status = pick(row, ["采购状态", "状态"]);
  const j = judgeStatus(status, name || code || "（无名）");
  return {
    code, name, status, matchedBy,
    supplier: pick(row, ["供应商", "供应商名称"]),
    note: pick(row, ["原始备注", "备注"]),
    verdict: j.verdict, priority: j.priority, conclusion: j.conclusion, row,
  };
}

export function lookupMaterial(rows: MaterialRowLike[], query: LookupQuery): LookupResult {
  const flags: string[] = [];
  const code = query.code?.trim() ?? "";
  const nameQ = query.name ? norm(query.name) : "";

  if (!code && !nameQ) {
    return { query, matchedBy: "none", hits: [], verdict: "not_found", headline: "没给编码也没给名称，查不了：至少给一个存货编码", flags };
  }

  // 1. 编码精确匹配
  let hits: LookupHit[] = [];
  let matchedBy: LookupResult["matchedBy"] = "none";
  if (code) {
    hits = rows.filter((r) => pick(r, CODE_KEYS) === code).map((r) => toHit(r, "code"));
    if (hits.length) matchedBy = "code";
    if (hits.length > 1) flags.push(`物料表里编码「${code}」出现 ${hits.length} 次，表本身有重复行，让物料管理员清一下`);
  }
  // 2. 名称包含匹配
  if (!hits.length && nameQ) {
    hits = rows.filter((r) => norm(pick(r, NAME_KEYS)).includes(nameQ)).map((r) => toHit(r, "name"));
    if (hits.length) {
      matchedBy = "name";
      if (code) flags.push(`编码「${code}」在物料表里没有，是按名称「${query.name}」找到的：编码对不上先和生产核对，不要按名称猜着下`);
      else flags.push("按名称模糊找到的：名称同名不同版很常见，下单前用存货编码再核一遍");
    }
  }

  if (!hits.length) {
    return {
      query, matchedBy: "none", hits: [], verdict: "not_found",
      headline: `❓ 物料表里找不到${code ? `编码「${code}」` : ""}${code && nameQ ? " / " : ""}${nameQ ? `名称含「${query.name}」` : ""}：编码对不上先和生产核对，不猜；也可能是物料表没更新，让管理员补行`,
      flags,
    };
  }

  const verdict: LookupVerdict = hits.length === 1 ? hits[0].verdict : "multiple";
  const headline = hits.length === 1
    ? hits[0].conclusion
    : `按名称找到 ${hits.length} 条：${hits.map((h) => `${h.code} ${h.name}（${h.status || "状态空"}）`).join("；")}——和生产确认是哪一条，用编码再查一次`;
  if (hits.length > 1 && hits.some((h) => h.verdict === "blocked") && hits.some((h) => h.verdict === "ok")) {
    flags.push("命中里既有在购也有停购版本：大概率是新旧版同名，下在购那条，停购那条别碰");
  }
  return { query, matchedBy, hits, verdict, headline, flags };
}
