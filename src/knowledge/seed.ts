// 把 knowledge/*.md 六篇 SOP 切成内置增强卡（origin:"builtin"），供 system-prompt 注入与 BM25 召回。
// 只读 md 原文，不调模型；切分规则见 splitMarkdownToCards。测试只跑 buildBuiltinCards，不碰 IndexedDB。
import type { EnhancementRow, XiaocaiStore } from "../db/schema";

const RAW = import.meta.glob<string>("../../knowledge/*.md", { query: "?raw", import: "default", eager: true });

/** 摘要总预算（按字符计），超出截断并加「…（详见原文）」 */
const EXAMPLE_BUDGET = 600;
const TRUNC_MARK = "…（详见原文）";

/** 触发词关键词表：出现在标题里的优先，其次按正文出现次数。大写缩写区分大小写，其余按原样子串匹配。 */
const TRIGGER_VOCAB = [
  "下单", "缺料", "加单", "急单", "加急", "请购", "采购订单", "PO", "MOQ", "起订量", "凑整", "分批", "交期", "倒推", "最晚下单日",
  "到货", "到货单", "到货预告", "到货计划", "入库", "入库单", "仓库", "质检", "报检", "欠交", "超交", "退货", "差异", "拒收",
  "跟单", "跟单表", "跟踪", "逾期", "催货", "在途", "运输", "物流", "运单号", "发货", "关闭订单", "完结", "简报", "周报",
  "供应商", "询价", "比价", "议价", "报价", "有效期", "签样", "回签", "备注", "账期", "付款", "发票", "三单匹配", "暂估", "对账", "税率", "含税",
  "库存", "现存量", "可用量", "调拨", "安全库存", "BOM", "编码", "存货档案", "供应商档案", "基础档案", "参照", "审核", "弃审", "单据状态",
  "U8", "用友", "版本", "菜单", "权限", "报表", "T+", "U9", "YonSuite",
  "5R", "QCDS", "准交率", "红线", "廉洁", "保密", "术语", "流程", "自查", "清单", "事故",
  "新人", "带教", "带新人", "话术", "请教", "汇报", "让成绩被看见", "老员工", "领导", "拍板", "选择题", "换轨", "出错", "复盘", "系统管理员", "生产计划", "月报", "观察",
];
const CASE_SENSITIVE = new Set(TRIGGER_VOCAB.filter((w) => /^[A-Z0-9+]+$/.test(w)));

/** 「别」「不要」只在提醒语境算警示（排除 要不要 / 别人/区别/分别/特别/差别/类别/个别/别的） */
const CAUTION_RE = /🔴|⚠️|(?<!要)不要|必须|(?<![区分特差类个])别(?![人的])/u;

const LIST_RE = /^\s*(?:\d+\.|[-*+])\s+(?:\[[ xX]\]\s*)?(.*)$/;
const TABLE_RE = /^\s*\|/;
const FENCE_RE = /^\s*```/;

interface Section {
  title: string;
  lines: string[];
}

export function isCautionLine(line: string): boolean {
  return CAUTION_RE.test(line);
}

function charLen(s: string): number {
  return Array.from(s).length;
}

function truncate(s: string, budget: number): string {
  const chars = Array.from(s);
  if (chars.length <= budget) return s;
  return chars.slice(0, Math.max(0, budget)).join("").trimEnd() + TRUNC_MARK;
}

/** 把一篇 md 拆成 h1 + 若干 `## ` 段。h1 之后、首个 `## ` 之前的前言并入第一段。 */
function splitSections(md: string): { h1: string; sections: Section[] } {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  let h1 = "";
  const sections: Section[] = [];
  const preamble: string[] = [];
  let cur: Section | null = null;
  let inFence = false;
  for (const line of lines) {
    if (FENCE_RE.test(line)) inFence = !inFence;
    if (!inFence && /^#\s+/.test(line) && !h1) {
      h1 = line.replace(/^#\s+/, "").trim();
      continue;
    }
    if (!inFence && /^##\s+/.test(line)) {
      cur = { title: line.replace(/^##\s+/, "").trim(), lines: [] };
      sections.push(cur);
      continue;
    }
    if (cur) cur.lines.push(line);
    else preamble.push(line);
  }
  if (sections.length && preamble.some((l) => l.trim())) {
    sections[0].lines = [...preamble, "", ...sections[0].lines];
  }
  return { h1, sections };
}

/** 去掉 h1 里的括注（「（默认按 U8+ 写）」这类），用作卡名前缀。 */
function cardPrefix(h1: string): string {
  return h1.replace(/（[^）]*）/g, "").replace(/\([^)]*\)/g, "").trim();
}

function countHits(hay: string, needle: string): number {
  let n = 0;
  let i = hay.indexOf(needle);
  while (i !== -1) {
    n++;
    i = hay.indexOf(needle, i + needle.length);
  }
  return n;
}

/** 优先级：卡标题词 → 正文出现 ≥2 次 → 一级标题词 → 正文出现 1 次。3~8 个。 */
function extractTriggers(title: string, body: string, h1: string): string[] {
  const inTitle: string[] = [];
  const inH1: string[] = [];
  const counted: { w: string; n: number }[] = [];
  for (const w of TRIGGER_VOCAB) {
    const cs = CASE_SENSITIVE.has(w);
    const needle = cs ? w : w.toLowerCase();
    const norm = (s: string) => (cs ? s : s.toLowerCase());
    if (norm(title).includes(needle)) inTitle.push(w);
    if (norm(h1).includes(needle)) inH1.push(w);
    const n = countHits(norm(body), needle);
    if (n > 0) counted.push({ w, n });
  }
  counted.sort((a, b) => b.n - a.n);
  const out: string[] = [];
  const push = (w: string) => {
    if (!out.includes(w) && out.length < 8) out.push(w);
  };
  inTitle.forEach(push);
  counted.filter((c) => c.n >= 2).forEach((c) => push(c.w));
  if (out.length < 3) inH1.forEach(push);
  if (out.length < 3) counted.forEach((c) => push(c.w));
  return out;
}

/**
 * 一篇 md → 若干张卡。每个 `## ` 一张：
 * - 列表行 → sop（`### ` 小标题作为「▶ 小标题」一行插进 sop，保住步骤归属）
 * - 含 🔴/⚠️/不要/别/必须 的行 → cautions（列表行同时保留在 sop 里，不破坏步骤顺序）
 * - 表格 / 代码块 / 其它段落 → examples（保留 markdown，总量 ≤ 600 字）
 */
export function splitMarkdownToCards(fileName: string, md: string): EnhancementRow[] {
  const base = fileName.replace(/\.md$/i, "");
  const { h1, sections } = splitSections(md);
  const prefix = cardPrefix(h1) || base;
  const cards: EnhancementRow[] = [];

  sections.forEach((sec, idx) => {
    const sop: string[] = [];
    const cautions: string[] = [];
    const paragraphs: string[] = [];
    let para: string[] = [];
    let table: string[] = [];
    let fence: string[] | null = null;
    const flushPara = () => {
      if (para.length) paragraphs.push(para.join("\n"));
      para = [];
    };
    const flushTable = () => {
      if (table.length) paragraphs.push(table.join("\n"));
      table = [];
    };
    const addCaution = (s: string) => {
      if (isCautionLine(s) && !cautions.includes(s)) cautions.push(s);
    };

    for (const raw of sec.lines) {
      if (fence) {
        fence.push(raw);
        if (FENCE_RE.test(raw)) {
          paragraphs.push(fence.join("\n"));
          fence = null;
        }
        continue;
      }
      if (FENCE_RE.test(raw)) {
        flushPara();
        flushTable();
        fence = [raw];
        continue;
      }
      if (TABLE_RE.test(raw)) {
        flushPara();
        table.push(raw.trim());
        continue;
      }
      flushTable();
      const line = raw.trim();
      if (!line || /^(-{3,}|\*{3,}|_{3,})$/.test(line)) {
        flushPara();
        continue;
      }
      const h3 = /^#{3,6}\s+(.*)$/.exec(line);
      if (h3) {
        flushPara();
        sop.push(`▶ ${h3[1].trim()}`);
        continue;
      }
      const li = LIST_RE.exec(raw);
      if (li) {
        flushPara();
        const item = li[1].trim();
        sop.push(item);
        addCaution(item);
        continue;
      }
      // 缩进续行：挂到上一条 sop
      if (/^\s{2,}/.test(raw) && sop.length && !para.length) {
        const merged = `${sop[sop.length - 1]} ${line}`;
        const last = sop[sop.length - 1];
        sop[sop.length - 1] = merged;
        const ci = cautions.indexOf(last);
        if (ci !== -1) cautions[ci] = merged;
        else addCaution(merged);
        continue;
      }
      const text = line.replace(/^>\s?/, "").trim();
      if (!text) continue;
      if (isCautionLine(text)) {
        addCaution(text);
        continue;
      }
      para.push(text);
    }
    flushPara();
    flushTable();

    // examples：共享 600 字预算
    const examples: string[] = [];
    let used = 0;
    for (const p of paragraphs) {
      const len = charLen(p);
      if (used + len <= EXAMPLE_BUDGET) {
        examples.push(p);
        used += len;
        continue;
      }
      const remain = EXAMPLE_BUDGET - used;
      if (remain > 20) examples.push(truncate(p, remain));
      else if (examples.length) examples[examples.length - 1] += TRUNC_MARK;
      else examples.push(truncate(p, EXAMPLE_BUDGET));
      break;
    }

    if (!sop.length && !cautions.length && !examples.length) return;
    const name = `${prefix} · ${sec.title}`;
    cards.push({
      id: `builtin:${base}:${idx + 1}`,
      name,
      intents: [sec.title, h1 || base],
      triggers: extractTriggers(sec.title, sec.lines.join("\n"), h1),
      sop,
      cautions,
      examples,
      enabled: true,
      origin: "builtin",
      conflictsWith: [],
      createdAt: 0,
      updatedAt: 0,
    });
  });
  return cards;
}

/** 所有内置卡，按文件名排序，id 稳定（builtin:<文件名去 .md>:<该篇第几个 ##>）。 */
export function buildBuiltinCards(): EnhancementRow[] {
  const paths = Object.keys(RAW).sort();
  const cards: EnhancementRow[] = [];
  for (const p of paths) {
    const fileName = p.split("/").pop() ?? p;
    cards.push(...splitMarkdownToCards(fileName, RAW[p]));
  }
  return cards;
}

/**
 * 幂等灌库：builtin 卡 bulkPut；已存在的同 id 卡保留用户的 enabled 开关；
 * 已不再生成的旧 builtin id 删除；origin ≠ builtin 的卡一律不动。
 */
export async function seedBuiltinCards(db: XiaocaiStore): Promise<{ put: number; removed: number }> {
  const fresh = buildBuiltinCards();
  return db.transaction("rw", db.enhancements, async () => {
    const existing = await db.enhancements.where("origin").equals("builtin").toArray();
    const byId = new Map(existing.map((r) => [r.id, r]));
    const rows = fresh.map((c) => {
      const old = byId.get(c.id);
      return old ? { ...c, enabled: old.enabled } : c;
    });
    await db.enhancements.bulkPut(rows);
    const freshIds = new Set(fresh.map((c) => c.id));
    const stale = existing.filter((r) => !freshIds.has(r.id)).map((r) => r.id);
    if (stale.length) await db.enhancements.bulkDelete(stale);
    return { put: rows.length, removed: stale.length };
  });
}
