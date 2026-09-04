/**
 * 「你的盲区」领域逻辑（需求 7）。
 *
 * 判定标准见 docs/DESIGN-blindspots.md §一 —— 三条同时成立才算一条盲区：
 *   ① 有她的原话证据；② 能映射到 plan.ts 里至少一条真实学习条目（= 会出事）；③ 是口径/流程/判断，不是一次性事实。
 * 另加两个抑制阀：unknown 类同主题第 2 次才记；**任何情况下不在对话里说教，静默入库**。
 *
 * 这里全是纯函数 + 一层薄存取。存取：桌面端走 desktop().call("blindspot.*")（新表 blindspots，建表由老架做），
 * 网页版或调用失败降级 localStorage（键 xiaocai.blindspots）。任何异常都当作「没有盲区」，绝不炸掉学习计划页。
 */

import { desktop, isDesktop } from "../data/bridge";
import { ITEMS } from "./plan";

export type BlindspotKind = "misconception" | "unknown" | "wrong_metric" | "process_gap";

export type BlindspotStatus = "open" | "learning" | "cleared";

export interface Blindspot {
  id: string;
  kind: BlindspotKind;
  /** 归到哪个知识主题（canonical key，见 TOPIC_RULES） */
  topic: string;
  /** 「拿现存量当可用量下单」——一句话说清是什么 */
  title: string;
  /** 她当时说的原话片段（证据，不许臆造） */
  evidence: string;
  /** 不纠正会出什么事（用后果说话，不训人） */
  why: string;
  /** 一句话正确口径 */
  fix: string;
  /** 关联到 plan.ts 的学习条目 */
  linkedItemIds: string[];
  occurrences: number;
  firstSeenAt: number;
  lastSeenAt: number;
  status: BlindspotStatus;
  sourceSessionId?: string;
  sourceMessageId?: string;
}

/** 模型/UI 递进来的一次观察：id / 计数 / 时间 / 状态由 mergeBlindspot 算 */
export type BlindspotInput = Omit<Blindspot, "id" | "occurrences" | "firstSeenAt" | "lastSeenAt" | "status">;

export const KIND_LABEL: Record<BlindspotKind, string> = {
  wrong_metric: "用错口径",
  process_gap: "跳了步骤",
  misconception: "记反了",
  unknown: "还不知道",
};

/** 后果权重：口径错和跳步骤直接出事故，排最前；「还不知道」最轻，只是待补 */
export const KIND_WEIGHT: Record<BlindspotKind, number> = {
  wrong_metric: 3,
  process_gap: 3,
  misconception: 2,
  unknown: 1,
};

// ---------------------------------------------------------------------------
// 主题归一表：把她的各种说法收敛到一个 canonical topic，并映射到真实学习条目。
// 「同主题不同措辞要合并」靠这张表实现；itemIds 必须是 plan.ts 里真实存在的 id（测试会校验）。
// ---------------------------------------------------------------------------

export interface TopicRule {
  topic: string;
  label: string;
  keywords: string[];
  itemIds: string[];
  /** 反复出问题时给的一句话提醒 */
  hint: string;
}

export const TOPIC_RULES: TopicRule[] = [
  {
    topic: "available-qty", label: "可用量口径",
    keywords: ["可用量", "现存量", "可用库存", "净可用", "预占", "库存有多少"],
    itemIds: ["B1-available-qty", "S1-stock-query"],
    hint: "算缺口前先把「可用量」这一列找准 —— 现存量里有别人预占的，照它下单会少下。",
  },
  {
    topic: "in-transit", label: "有效在途",
    keywords: ["在途", "有效在途", "逾期", "烂尾", "路上", "还没到"],
    itemIds: ["B2-effective-intransit", "S3-intransit-three-views"],
    hint: "在途要先剔掉逾期烂尾的那几行，剩下的才能抵缺口。",
  },
  {
    topic: "lead-time", label: "交期与生产日历",
    keywords: ["交期", "自然日", "工作日", "生产周期", "倒推", "提前期", "几天到"],
    itemIds: ["B3-lead-time-calendar", "B7-backward-schedule"],
    hint: "供应商说的「7 天」先问清是自然日还是工作日，再倒推最晚下单日。",
  },
  {
    topic: "moq-pack", label: "MOQ 与凑整单位",
    keywords: ["moq", "起订", "最小起订", "凑整", "一扎", "一箱", "包装单位"],
    itemIds: ["B4-moq-vs-pack"],
    hint: "MOQ 是「最少买多少」，凑整单位是「必须按扎/箱走」，两件事，别混。",
  },
  {
    topic: "tax", label: "含税与不含税",
    keywords: ["含税", "不含税", "税率", "价税", "13个点", "13%"],
    itemIds: ["B5-tax-basis", "S11-invoice-recon"],
    hint: "谈价先说死含税还是不含税，PO 上按谈的那个口径写。",
  },
  {
    topic: "save-audit", label: "保存与审核",
    keywords: ["保存", "审核", "弃审", "生效", "单据状态", "下了没"],
    itemIds: ["S2-save-vs-audit", "S8-amend-and-unaudit"],
    hint: "保存 ≠ 审核。没审核的单，供应商永远收不到，下游也参照不出来。",
  },
  {
    topic: "reference-doc", label: "参照生成 vs 手工敲单",
    keywords: ["参照", "手工敲", "手工录", "回写", "单据流", "拉单"],
    itemIds: ["S6-reference-vs-manual", "S7-receipt-and-stockin"],
    hint: "下游单据一律从上游参照生成，手工敲的不回写订单，报表会永远显示「未到」。",
  },
  {
    topic: "amend-close", label: "改单与关闭订单行",
    keywords: ["改单", "改订单", "关闭订单", "关行", "尾数", "关掉"],
    itemIds: ["S8-amend-and-unaudit", "S9-close-line"],
    hint: "改单要先弃审；到不了的尾数要手工关行，不然在途尾巴越挂越多。",
  },
  {
    topic: "provisional", label: "暂估与对账",
    keywords: ["暂估", "货到票未到", "月底", "发票", "对账", "追票"],
    itemIds: ["S10-provisional-estimate", "S11-invoice-recon"],
    hint: "货到票未到走暂估，月底财务催的是票不是你的错，配合追票即可。",
  },
  {
    topic: "arrival-notice", label: "到货预告",
    keywords: ["到货预告", "预告", "通知仓库", "提前告诉仓库"],
    itemIds: ["C1-arrival-notice"],
    hint: "到货预告是给仓库的接口协议，不是客套 —— 没预告，货记错订单谁都说不清。",
  },
  {
    topic: "warehouse-boundary", label: "入库权责边界",
    keywords: ["入库单", "谁录", "谁审", "越权", "仓库录", "我来录"],
    itemIds: ["C3-warehouse-boundary", "S7-receipt-and-stockin"],
    hint: "入库单归仓库录、仓库审，采购只核对。越权录了仓库不认这笔账。",
  },
  {
    topic: "delay-notify", label: "延误当天通知",
    keywords: ["延误", "晚到", "拖了", "当天通知", "先等等看", "再等等"],
    itemIds: ["C6-delay-notify-same-day"],
    hint: "延误当天就要通知生产。自己扛着等好消息，小延误会变成停线事故。",
  },
  {
    topic: "choice-question", label: "给选择题不给问答题",
    keywords: ["怎么办", "问了没人回", "催了没回复", "选择题", "截止时间"],
    itemIds: ["C7-choice-not-question"],
    hint: "要答复就给「A 方案 / B 方案 + 不回默认走 A + 截止时间」，别问「这个怎么办」。",
  },
  {
    topic: "inspection", label: "提前报检",
    keywords: ["质检", "报检", "待检", "检验", "免检"],
    itemIds: ["C5-inspection-early"],
    hint: "需检的料要提前报检，不然到了压在待检区，账上没库存生产领不出。",
  },
  {
    topic: "signback", label: "回签才算承诺",
    keywords: ["回签", "收到就行", "口头", "答应了", "说好了", "微信说"],
    itemIds: ["V1-signback"],
    hint: "「好的」「收到」都不算承诺，含数量和日期的回签才算。",
  },
  {
    topic: "shipped-three", label: "已发货三要素",
    keywords: ["已发货", "发了", "物流", "运单号", "预计到达"],
    itemIds: ["V2-shipped-three-things"],
    hint: "「发了」要问出三样：物流公司 + 运单号 + 预计到达日，缺一样都不算发。",
  },
  {
    topic: "chase-escalate", label: "催三次换轨",
    keywords: ["催", "催货", "再催", "第四次", "升级", "抄送", "换轨"],
    itemIds: ["V5-chase-three-times", "V6-escalation-writing"],
    hint: "同一件事催三次没结果就换轨（转书面 + 抄送），不催第四次。",
  },
  {
    topic: "approval-red-line", label: "超授权红线",
    keywords: ["加急", "超收", "改价", "加价", "答应供应商", "请示", "授权"],
    itemIds: ["V7-approval-before-promise", "B13-red-lines"],
    hint: "加急、超收、改价一律先请示再答应，超授权承诺是红线。",
  },
  {
    topic: "supplier-record", label: "供应商表现记录",
    keywords: ["准交率", "不良率", "绩效", "月度", "供应商表现", "凭印象"],
    itemIds: ["V8-performance-record", "V9-ontime-rate", "C10-monthly-supplier-note"],
    hint: "供应商每次表现当场记一笔，年底评审时你说的话才有分量。",
  },
  {
    topic: "net-gap", label: "净缺口算式",
    keywords: ["净缺口", "缺口", "算量", "该下多少", "被替代", "需求量"],
    itemIds: ["B8-net-gap", "B12-priority-model"],
    hint: "净缺口 = 需求 − 被替代 − 可用量 − 有效在途，一步都不能省。",
  },
  {
    topic: "po-elements", label: "PO 十要素",
    keywords: ["十要素", "订单要素", "采购订单必填", "po 怎么填", "订单怎么开"],
    itemIds: ["B9-po-ten-elements", "S4-po-create"],
    hint: "开单前把十要素过一遍，缺一项后面就有一处扯皮。",
  },
  {
    topic: "code-unit", label: "编码与计量单位",
    keywords: ["存货编码", "计量单位", "单位换算", "按只", "按扎", "编码对不上"],
    itemIds: ["B10-code-and-unit"],
    hint: "先按存货编码匹配，再核单位换算 —— 名字像不等于是同一个料。",
  },
  {
    topic: "discrepancy", label: "到货差异处理",
    keywords: ["短交", "少发", "多发", "差异", "不良", "退货", "少了几箱"],
    itemIds: ["V4-discrepancy"],
    hint: "差异当场书面记，别口头说「下次补」——补不补最后看有没有留痕。",
  },
  {
    topic: "price-validity", label: "价格有效期",
    keywords: ["价格有效期", "报价有效", "调价", "涨价", "还是老价格"],
    itemIds: ["B11-price-validity"],
    hint: "报价都有有效期，过期的价格下单，对账时差额算你头上。",
  },
  {
    topic: "coverage-days", label: "库存覆盖天数",
    keywords: ["覆盖天数", "够用几天", "安全库存", "断料"],
    itemIds: ["B6-coverage-days"],
    hint: "看「还够用几天」比看「还剩多少」有用 —— 天数才对得上生产节奏。",
  },
];

const ITEM_IDS = new Set(ITEMS.map((i) => i.id));
const RULE_BY_TOPIC = new Map(TOPIC_RULES.map((r) => [r.topic, r]));

const norm = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, "");

/**
 * 把任意措辞的主题收敛到 canonical topic。
 * 命中顺序：canonical key 精确匹配 → label 精确匹配 → 关键词包含（在 topic + 附带文本里找）。
 * 都不中就返回归一化后的原字符串（仍能合并「可用量 」「可用量」这类空格差异）。
 */
export function canonicalTopic(topic: string, extra = ""): string {
  const t = norm(topic);
  if (!t) return "";
  if (RULE_BY_TOPIC.has(t)) return t;
  for (const r of TOPIC_RULES) if (norm(r.label) === t) return r.topic;
  const hay = `${t}|${norm(extra)}`;
  for (const r of TOPIC_RULES) {
    for (const k of r.keywords) {
      const kk = norm(k);
      if (kk && hay.includes(kk)) return r.topic;
    }
  }
  return t;
}

/** 主题的中文名（没归一到已知主题时原样回显） */
export function topicLabel(topic: string): string {
  return RULE_BY_TOPIC.get(topic)?.label ?? topic;
}

/** 稳定 id：同一 kind + 同一 canonical 主题 ⇒ 同一条，重复出现合并而不是堆积 */
export function blindspotId(kind: BlindspotKind, topic: string): string {
  return `bs-${kind}-${topic || "unknown-topic"}`;
}

/**
 * 映射到 plan.ts 的学习条目 id。
 * 先按 canonical topic 查表；查不到就拿标题/正确口径/证据再扫一遍关键词。
 * **返回空数组 = 判定标准第 ② 条不成立 ⇒ 调用方应当丢弃这条盲区。**
 */
export function suggestPlanItems(b: Pick<Blindspot, "topic" | "title" | "fix" | "evidence">): string[] {
  const direct = RULE_BY_TOPIC.get(canonicalTopic(b.topic, `${b.title} ${b.fix}`));
  if (direct) return direct.itemIds.filter((id) => ITEM_IDS.has(id));
  const hay = norm(`${b.topic} ${b.title} ${b.fix} ${b.evidence}`);
  const hits: string[] = [];
  for (const r of TOPIC_RULES) {
    if (r.keywords.some((k) => norm(k) && hay.includes(norm(k)))) {
      for (const id of r.itemIds) if (ITEM_IDS.has(id) && !hits.includes(id)) hits.push(id);
    }
  }
  return hits;
}

/** 判定标准的可执行版本：三条同时成立才算一条盲区。不成立就别记。 */
export function isRecordable(input: BlindspotInput): boolean {
  if (!input.evidence?.trim()) return false; // ① 没原话 = 模型在臆造
  if (!input.title?.trim()) return false;
  return suggestPlanItems(input).length > 0; // ② 对不上任何学习条目 = 不会出事，不记
}

/**
 * 合并一次新观察。
 * - 同一 (kind, canonical topic) ⇒ occurrences += 1，firstSeenAt 保留，lastSeenAt 刷新，evidence 取最新原话
 * - 已 cleared 的主题再犯 ⇒ 自动顶回 open（她说懂了又犯了，要重新露头）
 * - 列表长度只在真·新主题时增长（幂等：反复 merge 同一条不会堆积）
 */
export function mergeBlindspot(existing: Blindspot[], incoming: BlindspotInput, now = Date.now()): Blindspot[] {
  const topic = canonicalTopic(incoming.topic, `${incoming.title} ${incoming.fix}`);
  const id = blindspotId(incoming.kind, topic);
  const linked = incoming.linkedItemIds?.length
    ? incoming.linkedItemIds.filter((x) => ITEM_IDS.has(x))
    : suggestPlanItems({ ...incoming, topic });
  const idx = existing.findIndex((b) => b.id === id);

  if (idx < 0) {
    const fresh: Blindspot = {
      id,
      kind: incoming.kind,
      topic,
      title: incoming.title.trim(),
      evidence: incoming.evidence.trim(),
      why: incoming.why?.trim() ?? "",
      fix: incoming.fix?.trim() ?? "",
      linkedItemIds: linked,
      occurrences: 1,
      firstSeenAt: now,
      lastSeenAt: now,
      status: "open",
      sourceSessionId: incoming.sourceSessionId,
      sourceMessageId: incoming.sourceMessageId,
    };
    return [...existing, fresh];
  }

  const prev = existing[idx];
  const merged: Blindspot = {
    ...prev,
    // 标题/后果/口径取最新一版非空值（模型每次可能说得更准）
    title: incoming.title.trim() || prev.title,
    why: incoming.why?.trim() || prev.why,
    fix: incoming.fix?.trim() || prev.fix,
    evidence: incoming.evidence.trim() || prev.evidence,
    linkedItemIds: [...new Set([...prev.linkedItemIds, ...linked])],
    occurrences: prev.occurrences + 1,
    lastSeenAt: now,
    status: prev.status === "cleared" ? "open" : prev.status,
    sourceSessionId: incoming.sourceSessionId ?? prev.sourceSessionId,
    sourceMessageId: incoming.sourceMessageId ?? prev.sourceMessageId,
  };
  const out = existing.slice();
  out[idx] = merged;
  return out;
}

const STATUS_WEIGHT: Record<BlindspotStatus, number> = { open: 2, learning: 1, cleared: 0 };

/** 排序分：后果重 + 反复出现 的排前面。导出便于测试与 UI 显示。 */
export function blindspotScore(b: Blindspot): number {
  return KIND_WEIGHT[b.kind] * 100 + Math.min(b.occurrences, 5) * 20 + STATUS_WEIGHT[b.status] * 10;
}

/** 稳定排序：分数 → lastSeenAt 新的在前 → id 字典序。同一份数据两次渲染顺序一致。 */
export function rankBlindspots(list: Blindspot[]): Blindspot[] {
  return list
    .slice()
    .sort((a, b) => blindspotScore(b) - blindspotScore(a) || b.lastSeenAt - a.lastSeenAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** 反复出问题的主题阈值：同一主题（未清掉的）累计出现 ≥3 次就算「这块一直在栽」 */
export const COVERAGE_GAP_THRESHOLD = 3;

/** 哪些主题反复出问题 —— 顶部一句话提醒用。已 cleared 的不计。 */
export function coverageGaps(list: Blindspot[]): { topic: string; hint: string }[] {
  const acc = new Map<string, number>();
  for (const b of list) {
    if (b.status === "cleared") continue;
    acc.set(b.topic, (acc.get(b.topic) ?? 0) + b.occurrences);
  }
  return [...acc.entries()]
    .filter(([, n]) => n >= COVERAGE_GAP_THRESHOLD)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .map(([topic]) => ({
      topic,
      hint: RULE_BY_TOPIC.get(topic)?.hint ?? `「${topicLabel(topic)}」这块反复出问题，找采姐把口径过一遍。`,
    }));
}

/** 本周（近 7 天）新增的条数 */
export function newThisWeek(list: Blindspot[], now = Date.now()): number {
  const from = now - 7 * 24 * 3600 * 1000;
  return list.filter((b) => b.firstSeenAt >= from).length;
}

// ---------------------------------------------------------------------------
// 存取：桌面端 blindspots 表（建表由老架做），失败或网页版降级 localStorage
// ---------------------------------------------------------------------------

export const BLINDSPOTS_KEY = "xiaocai.blindspots";

const KINDS: BlindspotKind[] = ["misconception", "unknown", "wrong_metric", "process_gap"];

/** 宽松解析：存坏了不要炸掉整页，解析不出来的整条丢掉 */
export function normalizeBlindspot(raw: unknown): Blindspot | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const kind = KINDS.includes(r.kind as BlindspotKind) ? (r.kind as BlindspotKind) : undefined;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const topic = canonicalTopic(str(r.topic));
  const title = str(r.title).trim();
  if (!kind || !topic || !title) return undefined;
  const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
  const first = num(r.firstSeenAt, Date.now());
  const status: BlindspotStatus = r.status === "learning" || r.status === "cleared" ? r.status : "open";
  return {
    id: typeof r.id === "string" && r.id ? r.id : blindspotId(kind, topic),
    kind,
    topic,
    title,
    evidence: str(r.evidence),
    why: str(r.why),
    fix: str(r.fix),
    linkedItemIds: Array.isArray(r.linkedItemIds) ? r.linkedItemIds.filter((x): x is string => typeof x === "string" && ITEM_IDS.has(x)) : [],
    occurrences: Math.max(1, Math.round(num(r.occurrences, 1))),
    firstSeenAt: first,
    lastSeenAt: num(r.lastSeenAt, first),
    status,
    sourceSessionId: typeof r.sourceSessionId === "string" ? r.sourceSessionId : undefined,
    sourceMessageId: typeof r.sourceMessageId === "string" ? r.sourceMessageId : undefined,
  };
}

export function parseBlindspots(raw: unknown): Blindspot[] {
  const rows = Array.isArray(raw) ? raw : raw && typeof raw === "object" ? Object.values(raw as Record<string, unknown>) : [];
  const out: Blindspot[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const b = normalizeBlindspot(r);
    if (b && !seen.has(b.id)) {
      seen.add(b.id);
      out.push(b);
    }
  }
  return out;
}

export function readLocalBlindspots(): Blindspot[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(BLINDSPOTS_KEY);
    return raw ? parseBlindspots(JSON.parse(raw) as unknown) : [];
  } catch {
    return [];
  }
}

export function writeLocalBlindspots(list: Blindspot[]): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(BLINDSPOTS_KEY, JSON.stringify(list));
  } catch {
    /* 隐私模式 / 配额满：静默降级，不打断她 */
  }
}

/** 读全部盲区。桌面端读 blindspots 表，失败降级 localStorage。 */
export async function loadBlindspots(): Promise<Blindspot[]> {
  if (isDesktop()) {
    try {
      return parseBlindspots(await desktop().call<unknown[]>("blindspot.list"));
    } catch {
      return readLocalBlindspots();
    }
  }
  return readLocalBlindspots();
}

async function persist(list: Blindspot[], changed: Blindspot): Promise<void> {
  if (isDesktop()) {
    try {
      await desktop().call("blindspot.set", changed);
      return;
    } catch {
      // 桌面端写失败就退回本地，至少别丢
    }
  }
  writeLocalBlindspots(list);
}

/**
 * 记一条盲区（静默）。不满足判定标准直接返回原列表，**不记、不报错、不在对话里说教**。
 * 返回合并后的完整列表，UI 直接拿去渲染。
 */
export async function noteBlindspot(input: BlindspotInput, now = Date.now()): Promise<Blindspot[]> {
  if (!isRecordable(input)) return loadBlindspots();
  const cur = await loadBlindspots();
  const next = mergeBlindspot(cur, input, now);
  const id = blindspotId(input.kind, canonicalTopic(input.topic, `${input.title} ${input.fix}`));
  const changed = next.find((b) => b.id === id);
  if (changed) await persist(next, changed);
  return next;
}

/** 三态切换：先放着(open) / 我要学(learning) / 已经懂了(cleared)。全部可反悔。 */
export async function setBlindspotStatus(id: string, status: BlindspotStatus): Promise<Blindspot[]> {
  const cur = await loadBlindspots();
  const idx = cur.findIndex((b) => b.id === id);
  if (idx < 0) return cur;
  const next = cur.slice();
  next[idx] = { ...cur[idx], status };
  await persist(next, next[idx]);
  return next;
}

/**
 * unknown 类的抑制阀：同一主题第一次问只答不记，第二次才记。
 * 调用方（工具层）先问它，返回 false 就直接跳过。
 */
export function shouldRecordUnknown(existing: Blindspot[], topic: string, asked: Set<string>): boolean {
  const t = canonicalTopic(topic);
  if (!t) return false;
  if (existing.some((b) => b.topic === t)) return true; // 这个主题已经有记录了，说明不是第一次
  if (asked.has(t)) return true;
  asked.add(t);
  return false;
}
