/**
 * 学习计划（章程化）—— 这位采购新人，设计转采购的新人，制造业食品厂 + 用友 U8+。
 *
 * 骨架来自采姐规格书 §7「知识盲区 20 条」+ 四个月学习节奏表；
 * 苏姐 §6 明确砍掉「测验 / 打分 / 证书 / 连续打卡」——**这里没有考试**。
 * 每条只有三样东西：怎么学（learn）、在真实工作里做什么（practice）、
 * 学会了拿什么证明（proof，客观可验证，不是"我觉得懂了"）。
 *
 * ⚠️ refs 里 kind:"tutorial" 的 id 需与 U8 教程模块（src/tutorial/content.ts）的条目 id 对齐。
 *    本文件**刻意不 import 教程模块**，只写字符串 id，避免两个模块互相锁死；
 *    下面的 TUTORIAL_IDS_SNAPSHOT 是 2026-09-03 教程模块的 id 快照，测试拿它当校验靶子。
 *    接入时由老架做一次「plan.refs.tutorial ⊆ tutorial.ids」的真实校验；
 *    教程若改 id，改这份快照 + 对应 refs 即可，两边不必同时改代码。
 *    kind:"card" / "sop" 的 id 对应 ~/.claude/skills/procurement/knowledge-base/ 下的文件名（去掉 .md）。
 */

/** src/tutorial/content.ts 的条目 id 快照（2026-09-03）。只用于本模块的自检，不是权威源。 */
export const TUTORIAL_IDS_SNAPSHOT = [
  "po-query",
  "po-list",
  "po-exec-stat",
  "stock-query",
  "in-transit-scopes",
  "po-instock-query",
  "export-excel",
  "import-standard",
  "import-archive",
  "import-no-permission",
  "flow-standard",
  "flow-return",
  "flow-provision",
] as const;

export type Track = "basics" | "system" | "collab" | "supplier";

export interface TrackMeta {
  id: Track;
  name: string;
  /** 这条赛道解决她的哪个"不会" */
  blurb: string;
}

export interface LearningItem {
  id: string;
  track: Track;
  /** 第几周（1-16） */
  week: number;
  title: string;
  /** 不懂会出什么事——用采姐 §7 的后果描述，具体到"哪一步崩、谁背锅" */
  why: string;
  /** 怎么学：读哪张卡 / 看哪篇教程 / 问谁 */
  learn: string[];
  /** 实操任务：在真实工作里做一件什么事 */
  practice: string;
  /** 学会了的凭据（客观可验证） */
  proof: string;
  minutes: number;
  /** 前置条目 id */
  deps?: string[];
  refs?: { kind: "tutorial" | "card" | "sop"; id: string; label: string }[];
}

export interface Chapter {
  id: string;
  track: Track;
  name: string;
  goal: string;
  items: string[];
}

export const TRACKS: TrackMeta[] = [
  { id: "basics", name: "基础知识", blurb: "算账的口径。口径错了，后面每一步都白做。" },
  { id: "system", name: "系统操作", blurb: "U8 里怎么查、怎么开、怎么改、怎么收尾。" },
  { id: "collab", name: "跨部门对接", blurb: "跟仓库、生产、质检、财务、领导的接口协议。" },
  { id: "supplier", name: "供应商对接", blurb: "怎么让承诺落地，怎么在出问题时不吃亏。" },
];

export const TRACK_LABELS: Record<Track, string> = {
  basics: "基础知识",
  system: "系统操作",
  collab: "跨部门对接",
  supplier: "供应商对接",
};

/** 每周的主题（16 周 = 四个月，配合采姐带教节奏） */
export const WEEK_THEMES: Record<number, string> = {
  1: "命门一：库存到底有多少",
  2: "命门二：算账的三个口径",
  3: "把口径变成算式",
  4: "净缺口跑通一遍",
  5: "开出第一张挑不出毛病的单",
  6: "单发出去之后靠什么盯",
  7: "一天怎么排，先做哪个",
  8: "第一个月收口：边界与五问",
  9: "货到了：到货、入库、报检",
  10: "改单、关行、问价",
  11: "催货：从电话到书面",
  12: "对上沟通与红线",
  13: "月末：暂估与对账",
  14: "把供应商管起来（用数字）",
  15: "让做成的事被看见",
  16: "收官：把 20 条盲区变成你的地图",
};

// ---------------------------------------------------------------------------
// 条目（48 条）。前 5 条是采姐点名「不懂就立刻出事」的五个命门。
// ---------------------------------------------------------------------------

export const ITEMS: LearningItem[] = [
  // ===== 命门五条 =====
  {
    id: "B1-available-qty",
    track: "basics",
    week: 1,
    title: "可用量 ≠ 现存量",
    why: "现存量里含着被别的订单预占、被冻结的部分。照现存量算缺口就会少下单，生产开线那天才发现料被别人领走了——直接停线，而且当天补不上。",
    learn: [
      "读 01-skill-tree §2.3「库存与需求常识」，把现存量 / 可用量 / 冻结量三个词分清",
      "记住 U8 的公式：可用量 = 现存量 − 冻结量 + 预计入库量 − 预计出库量",
      "问 U8 管理员一句：咱们账套的可用量列到底叫「可用量」还是「可用库存 / 净可用」",
    ],
    practice: "挑本厂 A 类的 3 个料（先拿 5 项日配件里的任意 3 个），把现存量和可用量两列并排抄到一张纸上，看差多少。",
    proof: "能说出本厂日配件里现存量与可用量差得最多的那一个料的编码、两个数字，并有一张现存量查询结果的截图。",
    minutes: 25,
    refs: [
      { kind: "card", id: "01-skill-tree", label: "01 技能树 §2.3 库存与需求常识" },
      { kind: "tutorial", id: "stock-query", label: "U8 教程 · 现存量查询" },
    ],
  },
  {
    id: "B2-effective-intransit",
    track: "basics",
    week: 1,
    title: "有效在途 ≠ 在途",
    why: "跟单表上写着「在途 20000」，其中一批已经逾期十天、供应商说不清什么时候发——那批是烂尾，不能当有效在途。把它算进去，缺口会被低估一半，而且等你发现时已经来不及补救。",
    learn: [
      "读 05-sop-tracking §1「每日跟单动作」，看三色判定怎么把在途分成绿/黄/红",
      "规则记牢：逾期未决（红且没有新交期）的在途，一律从有效在途里剔除",
    ],
    practice: "把当前跟单表所有未完结行拉出来，逐行标「有效 / 烂尾」，烂尾的写一句为什么（逾期几天、上次沟通结论是什么）。",
    proof: "跟单表上有一列「是否有效在途」已填满，烂尾行的条数能报出来，且每条有一句剔除理由。",
    minutes: 25,
    refs: [{ kind: "sop", id: "05-sop-tracking", label: "05 订单跟踪 SOP §1" }],
  },
  {
    id: "B3-lead-time-calendar",
    track: "basics",
    week: 2,
    title: "生产周期口径：7 天是自然日还是工作日",
    why: "供应商嘴里的「7 天」可能是 7 个工作日，加上周末就是 9 个自然日；再加上他周二周四才发车、16:00 后下单算明天接单——三个口径叠起来，你以为的第 7 天其实是第 11 天，停线两天。",
    learn: [
      "读 03-sop-place-order 第二步「定供应商与价格」，看生产周期、运输天数、发车日、接单截止四个字段的定义",
      "打电话把两家供应商的口径逐条问实：生产周期按自然日还是工作日？春节国庆停几天？每周哪天发车？几点前下单算今天？",
    ],
    practice: "把两家供应商的 production_days / production_calendar / transport_days / ship_weekdays / order_cutoff / shutdown_periods 六个字段填进供应商档案表。",
    proof: "supplier-profiles 里两家供应商的这六个字段全部非空，且每个字段旁写了「谁说的、哪天问的」。",
    minutes: 30,
    refs: [
      { kind: "sop", id: "03-sop-place-order", label: "03 下单 SOP · 第二步" },
      { kind: "card", id: "my-supplier-scope", label: "我的供应商范围" },
    ],
  },
  {
    id: "B4-moq-vs-pack",
    track: "basics",
    week: 2,
    title: "MOQ 与凑整单位是两回事",
    why: "MOQ 是「最少得买这么多」，凑整单位是「必须按扎/箱走」。你下 8000 只，供应商按 500 只/扎自己凑成 8500 发货，到货数跟订单数对不上，入库单卡住、对账也对不平，最后账要你自己去平。",
    learn: [
      "读 03-sop-place-order 第一步的算账部分，把 MOQ 与 pack_unit 两个字段分开记",
      "记住三选一：凑到 MOQ / 问能不能拼单 / 合并到下次一起下——这三个是给你选的，不是系统替你选",
    ],
    practice: "拿本周任意一条缺口小于 MOQ 的料，把三个方案的数量和后果各写一行（多买多少钱压在仓库 / 拼单要等几天 / 合并会不会断料），然后自己选一个并写明理由。",
    proof: "有一张三选一对照表，最终选择那一行画了圈并写了一句理由；下单数量确实按凑整单位向上取整。",
    minutes: 25,
    deps: ["B1-available-qty"],
    refs: [{ kind: "sop", id: "03-sop-place-order", label: "03 下单 SOP · 第一步" }],
  },
  {
    id: "B5-tax-basis",
    track: "basics",
    week: 2,
    title: "含税价 / 不含税价 / 税率的口径",
    why: "单价谈的是不含税，PO 上写成含税，一单就差 13%。几千块的差额在对账时才暴露，供应商咬定谈的是他那个口径，最后这笔账算在采购头上——第一次就把专业信用赔进去。",
    learn: [
      "读 01-skill-tree §1.3「单据与对数常识」，把含税/不含税/税率三者的换算关系抄一遍",
      "看清 U8 采购订单表体里到底有「无税单价 / 含税单价 / 税率」哪几列，本厂默认录哪一列",
    ],
    practice: "拿一张历史订单，用不含税价 ×(1+税率) 手算一遍含税总额，和 U8 上的数字对一对，对不上就找出差在哪。",
    proof: "能一句话说出本厂两家供应商各自的报价口径（含税/不含税）和税率，且在供应商档案的 tax_rate 字段里已填。",
    minutes: 30,
    refs: [
      { kind: "card", id: "01-skill-tree", label: "01 技能树 §1.3" },
      { kind: "tutorial", id: "po-query", label: "U8 教程 · 采购订单" },
    ],
  },

  // ===== 第 1 周补一条系统操作 =====
  {
    id: "S1-stock-query",
    track: "system",
    week: 1,
    title: "现存量查询：把可用量真的查出来",
    why: "概念懂了但查不出来等于没懂。更常见的坑是「到货/在检量」这一列空白——那是因为到货单没填仓库，你会误以为没有货在门口，白白多下一批。",
    learn: [
      "看教程「现存量查询」：路径 供应链 → 库存管理 → 报表(或业务报表) → 库存账 → 现存量查询",
      "过滤条件里三个勾选项要认识：显示零结存存货 / 包含停用存货 / 显示零可用存货",
      "如果「到货/在检量」列空白，去 库存管理 → 选项 → 可用量控制 看那个勾有没有打上",
    ],
    practice: "查一次 5 项日配件的现存量，把现存量 / 可用量 / 预计入库量 / 到货在检量四列截图，贴到教程的空截图槽里。",
    proof: "教程「现存量查询」那一页的截图槽已被本厂真实截图填上，且能指出这四列各在哪。",
    minutes: 30,
    deps: ["B1-available-qty"],
    refs: [
      { kind: "tutorial", id: "stock-query", label: "U8 教程 · 现存量查询" },
      { kind: "card", id: "02-u8-basics", label: "02 U8 基础 §3 常用入口" },
    ],
  },

  // ===== 第 3 周 =====
  {
    id: "B6-coverage-days",
    track: "basics",
    week: 3,
    title: "覆盖天数：断料预警的唯一数字",
    why: "「库存还有 8000 只」这句话没有信息量。日均用 3353 只，8000 只就是 2.4 天——不到 3 天就该动手了。不会算覆盖天数，你的紧急感就永远来自别人的电话，而不是自己的判断。",
    learn: [
      "公式背下来：覆盖天数 =（可用量 + 有效在途）÷ 日均用量",
      "阈值记牢：< 3 天亮红、< 5 天要检讨安全库存是不是设低了",
      "日均用量从哪来：物料表 daily_usage，没有的从原始备注里抠，抠不出来就问生产",
    ],
    practice: "给 5 项日配件 + 2 项警示件各算一次今天的覆盖天数，排个序，把最低的那件的动作写下来（调拨 / 催货 / 通知生产，三选一）。",
    proof: "有一张 7 行的水位表（料号 / 可用量 / 有效在途 / 日均用量 / 覆盖天数），< 3 天的每一行都有一个已执行的动作。",
    minutes: 30,
    deps: ["B1-available-qty", "B2-effective-intransit"],
    refs: [{ kind: "sop", id: "05-sop-tracking", label: "05 订单跟踪 SOP §1" }],
  },
  {
    id: "B7-backward-schedule",
    track: "basics",
    week: 3,
    title: "交期倒推：算出最晚下单日",
    why: "不会倒推，就只能在需求日快到时才慌。最晚下单日一过，你能做的只剩加急和求人改计划，两样都要花钱、都要请示——而这本来是提前三天就能避免的。",
    learn: [
      "倒推链条：需求日 − 运输天数 − 生产周期 − 接单截止顺延 = 最晚下单日",
      "读 03-sop-place-order 第一步末尾的倒推示例，注意日历口径（自然日/跳周日/工作日）会改变结果",
      "小采里 backward_schedule 工具会算，但你必须能在纸上复算一遍——不然错了你看不出来",
    ],
    practice: "挑 3 条下周要下的需求，手算最晚下单日，再用小采的倒推工具跑一遍，对不上就找出是哪个字段填错了。",
    proof: "3 条需求的手算结果与工具结果一致；不一致的那条能说清差异出在哪个字段。",
    minutes: 30,
    deps: ["B3-lead-time-calendar"],
    refs: [{ kind: "sop", id: "03-sop-place-order", label: "03 下单 SOP · 第一步" }],
  },
  {
    id: "S2-save-vs-audit",
    track: "system",
    week: 3,
    title: "保存 ≠ 审核（U8 里单据不审核不生效）",
    why: "你以为单下了，其实它只是躺在草稿里：供应商收不到、下游到货单参照不出来、执行报表上永远是零。一周后货没到你才发现——这一周的补救窗口全丢了。",
    learn: [
      "读 02-u8-basics §2「必须刻进肌肉记忆的四个系统概念」第一条",
      "看教程「采购订单」，认清工具栏上「保存」和「审核」是两个按钮，审核后单据抬头会变状态",
      "顺带确认权限：你能不能自审订单？不能的话审核人是谁、他一般什么时候审",
    ],
    practice: "翻一遍本月所有采购订单的状态列，找出「开立」（未审核）的那些，逐张确认是有意留着还是漏审了。",
    proof: "能说出本月有几张单停在未审核状态、分别为什么；并能指着 U8 界面说出审核按钮在哪、审核后哪里变了。",
    minutes: 25,
    refs: [
      { kind: "card", id: "02-u8-basics", label: "02 U8 基础 §2" },
      { kind: "tutorial", id: "po-query", label: "U8 教程 · 采购订单" },
    ],
  },

  // ===== 第 4 周 =====
  {
    id: "B8-net-gap",
    track: "basics",
    week: 4,
    title: "净缺口：把前面几条串成一个算式",
    why: "净缺口算错，后面所有事都是白忙。多算了压库存占钱，少算了停线。而算错的原因几乎永远是输入错——可用量取成了现存量，或者在途里混了烂尾。",
    learn: [
      "算式：净缺口 = 需求量 − 可用量 − 有效在途 + 安全库存（多仓要先算他仓可调量）",
      "多仓顺序记牢：先调拨后采购，调拨比下单快",
      "读 03-sop-place-order 第一步整节，把「核对输入」而不是「重算」这个习惯建立起来",
    ],
    practice: "拿本周真实生产表跑一次全量净缺口，然后只做一件事：逐行核对输入（可用量列对不对、在途剔干净没有），把改动过的行标出来。",
    proof: "有一份带「输入已核对」勾的缺口清单；能报出核对后跟核对前差了几行、差了多少数量。",
    minutes: 30,
    deps: ["B1-available-qty", "B2-effective-intransit", "B6-coverage-days"],
    refs: [{ kind: "sop", id: "03-sop-place-order", label: "03 下单 SOP · 第一步" }],
  },
  {
    id: "S3-intransit-three-views",
    track: "system",
    week: 4,
    title: "U8 里的「在途」有三种口径",
    why: "你说在途 2 万，仓库说在途 5000，其实你们看的是两张表的两列。分不清三种口径，跟人对数时你没法自证，久了别人就不信你的数字。",
    learn: [
      "A 订了还没到：采购订单执行统计表的「订单数量 − 累计到货数量」",
      "B 到了没入库：现存量查询的「到货/在检量」列",
      "C 未来会进来：现存量查询的「预计入库量」，或库存展望",
      "看教程「三种在途口径」的对照图，记住自己每天用的是 A + B",
    ],
    practice: "挑一个日配件，同一天把 A / B / C 三个数字都查出来记在一张纸上，写清各是什么意思。",
    proof: "一张三口径对照记录（料号 + 日期 + 三个数字 + 各自出处），能对着它跟仓库解释差异从哪来。",
    minutes: 25,
    deps: ["B2-effective-intransit", "S1-stock-query"],
    refs: [
      { kind: "tutorial", id: "in-transit-scopes", label: "U8 教程 · 待入库量/在途量三种口径" },
      { kind: "tutorial", id: "po-exec-stat", label: "U8 教程 · 采购订单执行统计表" },
    ],
  },
  {
    id: "C1-arrival-notice",
    track: "collab",
    week: 4,
    title: "到货预告是给仓库的接口协议，不是客套",
    why: "没有预告，仓库就「来什么收什么」，A 供应商的货点到 B 订单上，对账时两边都说不清，最后要你一单一单去翻照片。预告发出去还得有人回一个字——没人回就等于没发。",
    learn: [
      "读 04-sop-goods-receipt 第一步，把六列表的列名背下来",
      "记住两个时间戳：notified_at（发出）和 ack_at（仓库回执），少一个都不算完成",
      "急料要标「到了优先点数」，需检的要标「先报检」",
    ],
    practice: "连续三天，每天 15:30 生成明日到货预告发仓库群，@到具体的人（不发「各位」），并把回执截图留档。",
    proof: "连续三天的预告记录 + 三次仓库回执截图；能报出这三天里有几单是靠预告提前拦下的问题。",
    minutes: 30,
    refs: [{ kind: "sop", id: "04-sop-goods-receipt", label: "04 入库对接 SOP · 第一步" }],
  },

  // ===== 第 5 周 =====
  {
    id: "B9-po-ten-elements",
    track: "basics",
    week: 5,
    title: "一张合格 PO 的十要素",
    why: "缺一个要素，日后就多一次扯皮：没写交货地点货送错仓，没写含税口径对账差 13%，没写验收标准来了不良你退不掉。这十项不是形式，是你事后唯一的依据。",
    learn: [
      "读 01-skill-tree §1.2「订单要素」+ order-checklist §A",
      "过一遍小采的 check_po 十要素检查，看它挑出来的都是哪几类问题",
    ],
    practice: "拿本周要发的订单，发出前用十要素逐条勾一遍，缺的补上再发。",
    proof: "至少两张订单有完整的十要素勾选记录；能说出自己最常漏的是哪一项。",
    minutes: 30,
    deps: ["B5-tax-basis"],
    refs: [
      { kind: "card", id: "01-skill-tree", label: "01 技能树 §1.2 订单要素" },
      { kind: "sop", id: "order-checklist", label: "下单自查清单 §A" },
    ],
  },
  {
    id: "S4-po-create",
    track: "system",
    week: 5,
    title: "在 U8 开一张采购订单（并审核）",
    why: "开单是这个岗位的主动作。一单一供应商、计划到货日填供应商承诺日而不是需求日——这两条写错，跟单报表从第一天起就是歪的。",
    learn: [
      "看教程「采购订单」：供应链 → 采购管理 → 采购订货 → 采购订单 → 增加",
      "读 03-sop-place-order 第三步，注意「计划到货日填供应商承诺日」这条",
      "如果表体选不出某个存货，看报错是不是「不在当前供应商的供货范围内」——那是供应商存货对照表没维护，不是你选错了",
    ],
    practice: "独立开出本周该下的单并完成审核，然后导出发给供应商，记下发出时间。",
    proof: "U8 里有你开的、状态为「已审核」的订单号；跟单表上这几张单的 sent_at 已填。",
    minutes: 30,
    deps: ["S2-save-vs-audit", "B9-po-ten-elements"],
    refs: [
      { kind: "tutorial", id: "po-query", label: "U8 教程 · 采购订单" },
      { kind: "sop", id: "03-sop-place-order", label: "03 下单 SOP · 第三步" },
    ],
  },
  {
    id: "V1-signback",
    track: "supplier",
    week: 5,
    title: "回签才算承诺（「好的」「收到」不算）",
    why: "全流程最常被跳过的一步——新人以为订单发出去就下完了。供应商「以为」是下周的单，到期没货，扯皮时你拿不出任何凭据。回签必须含数量和每批到货日，缺一样都不是回签。",
    learn: [
      "四项必须齐：数量 / 单价 / 分批计划 / 每批到货日",
      "节奏记牢：发出后 4 小时内问一句「收到了吗」（只确认收到，不聊别的），24 小时内要回签件",
      "回签交期跟 PO 不一致时不是「知道了」，是回去重新倒推",
    ],
    practice: "对本周发出的每一张单，按 4 小时 / 24 小时两个节点跟一次，把回签件（图片/PDF/明确文字都行）存进任务卡附件。",
    proof: "本周每张已发出订单都有回签件附件，且跟单表「承诺交期」列已按回签回填（不是按需求日）。",
    minutes: 25,
    deps: ["S4-po-create"],
    refs: [{ kind: "sop", id: "03-sop-place-order", label: "03 下单 SOP · 第四步 收尾登记" }],
  },

  // ===== 第 6 周 =====
  {
    id: "V2-shipped-three-things",
    track: "supplier",
    week: 6,
    title: "「已发货」必须有三样：物流公司 + 运单号 + 预计到达日",
    why: "只信口头「发了」，到期没到才发现根本没发——白白丢掉三天补救窗口，而这三天本来够调拨或者换供应商。",
    learn: [
      "读 05-sop-tracking §3「运输情况跟踪」",
      "规则：跟单表物流单号列为空的行，状态一律不许标「已发货」",
      "运单号到手后看物流节点，停滞 ≥ 2 天就两头催（供应商 + 物流）",
    ],
    practice: "把跟单表里所有标了「已发货」但没运单号的行找出来，逐条去要三样；要不到的把状态改回「未发货」。",
    proof: "跟单表里不存在「已发货且物流单号为空」的行；能报出这次改回了几行。",
    minutes: 25,
    deps: ["V1-signback"],
    refs: [{ kind: "sop", id: "05-sop-tracking", label: "05 订单跟踪 SOP §3" }],
  },
  {
    id: "S5-po-exec-report",
    track: "system",
    week: 6,
    title: "采购订单执行统计表：跟单的主力表",
    why: "这张表上的「累计到货 / 累计入库 / 未到数量」是你每天判断事情有没有推进的唯一客观依据。不会看它，你就只能靠问人，而问来的答案没有时间戳。",
    learn: [
      "看教程「采购订单执行统计表」：供应链 → 采购管理 → 报表 → 统计表（路径 ⚠️ 待实机核对，核对完把 ⚠️ 去掉）",
      "三列的意思：订单数量 / 累计到货 / 累计入库；未到数量 = 订单数量 − 累计到货",
      "货到了但累计入库不涨 = 单据卡住了，不是货没到",
    ],
    practice: "每天早上导一次这张表，跟跟单表比对，把两边对不上的行列出来（以 U8 为准，不改 U8）。",
    proof: "连续三天的比对记录；能说出这三天累计有几行对不上、原因分别是什么。",
    minutes: 30,
    deps: ["S3-intransit-three-views"],
    refs: [
      { kind: "tutorial", id: "po-exec-stat", label: "U8 教程 · 采购订单执行统计表" },
      { kind: "sop", id: "05-sop-tracking", label: "05 订单跟踪 SOP §1" },
    ],
  },
  {
    id: "B10-code-and-unit",
    track: "basics",
    week: 6,
    title: "认编码不认名称；单位与换算要写清",
    why: "「三拼腰封」这个名字底下可能挂着三个编码。按名字沟通，早晚有一次下错料；单位写「箱」不写「每箱多少只」，到货点数点不明白，入库对不了账。",
    learn: [
      "存货编码是全公司唯一的语言，微信里说事也带编码",
      "只 / 箱 / 扎 三种单位在本厂各自的换算关系问清楚，写进物料表",
      "读 01-skill-tree §5「常用术语速查」",
    ],
    practice: "把 152 项物料里名称相近、容易混的挑出来（至少 5 组），做一张「名称 → 编码」对照小抄贴在工位。",
    proof: "工位上有那张对照小抄；且最近一周的微信沟通里，涉及物料时都带了编码。",
    minutes: 20,
    refs: [{ kind: "card", id: "01-skill-tree", label: "01 技能树 §5 术语速查" }],
  },

  // ===== 第 7 周 =====
  {
    id: "B12-priority-model",
    track: "basics",
    week: 7,
    title: "先做哪个：为什么金额只值 8 分",
    why: "新人最常见的误判是「金额大的先做」。金额大的单晚一天通常只是资金占用，日配件晚一天是整条产线停。按金额排序，你会在最贵的单上花一上午，然后下午被停线电话打懵。",
    learn: [
      "看优先级公式：时间压力 35 + 断料风险 30 + 是否日配 12 + 金额 8 + 供应商风险 8 + 停滞 7",
      "看采姐给的三个算例（A 82.1 / C 67.3 / B 37.5），重点看 B 为什么排最后",
      "记住 f_aging 的作用：难啃的任务会自己往上冒，不会永远沉底",
    ],
    practice: "把今天所有未闭环的事按公式打一遍分排序，跟你凭直觉排的顺序对比，看差在哪几条。",
    proof: "有一张「直觉序 vs 打分序」的对照表，且能说出自己直觉最容易高估的是哪一类（多数人是金额）。",
    minutes: 25,
    deps: ["B6-coverage-days"],
    refs: [{ kind: "card", id: "01-skill-tree", label: "01 技能树 §2.3" }],
  },
  {
    id: "C2-daily-rhythm",
    track: "collab",
    week: 7,
    title: "一天的固定节奏：别让微信决定你的优先级",
    why: "一上班就开微信，你一天的顺序就变成「谁先给我打电话」。微信里的事永远是别人的优先级。没有固定节奏，你会忙一整天却说不出自己推进了什么。",
    learn: [
      "读采姐的时间轴：08:30 开机三件事 / 08:45 打电话时段 / 09:30 下单时段 / 15:30 到货预告 / 16:30 收口",
      "两个关键点：打电话集中在供应商刚上班那 45 分钟；下单放在脑子最清楚的时候",
      "收口的意义：没闭环不要紧，「没交代」才要命",
    ],
    practice: "按这个节奏走满五个工作日，每天下班前记一句「今天哪个时段被打断了、被什么打断的」。",
    proof: "五天的节奏执行记录；能说出最常打断你的是哪一类事，以及你打算怎么把它挪进固定时段。",
    minutes: 30,
    refs: [{ kind: "sop", id: "05-sop-tracking", label: "05 订单跟踪 SOP §1 每日跟单" }],
  },
  {
    id: "V3-supplier-file",
    track: "supplier",
    week: 7,
    title: "供应商档案：把口头信息变成字段",
    why: "「他们家一般一周能到」这种话在你脑子里，你休假那天就没人知道了。更要命的是催货时找不到人——联系人电话、升级时抄送谁，这两个字段空着，出事那天你只能干等。",
    learn: [
      "读 my-supplier-scope + supplier-profiles 的字段说明",
      "必填字段：联系人+电话 / 备用联系人 / 升级抄送人（对方销售上级）/ 付款条款 / 开票主体 / 税率 / 生产周期 / 日历口径 / 运输天数 / 发车日 / 接单截止 / 收货窗口",
      "升级抄送人是催货换轨的关键字段，一定要在关系还好的时候问到",
    ],
    practice: "把两家供应商的档案字段补全，缺的当面或电话问；每个字段标注来源和日期。",
    proof: "supplier-profiles 里两家供应商的必填字段 0 空缺，且 escalation_contact（抄送谁）已填。",
    minutes: 25,
    deps: ["B3-lead-time-calendar"],
    refs: [
      { kind: "card", id: "my-supplier-scope", label: "我的供应商范围" },
      { kind: "card", id: "01-skill-tree", label: "01 技能树 §2.2 供应商管理入门" },
    ],
  },

  // ===== 第 8 周 =====
  {
    id: "S6-reference-vs-manual",
    track: "system",
    week: 8,
    title: "参照生成 vs 手工敲单（下游必须从上游拉）",
    why: "手工敲的入库单不回写订单的累计入库——跟踪报表就永远显示「未到」，整条数据链断掉。等你发现时，几十张单的数据都得回头人工对。",
    learn: [
      "读 02-u8-basics §1「采购单据流全景」+ 教程「单据流与参照生单」",
      "两种做法：在上游单据上点下游按钮（订单上点「到货」），或在下游单据里参照上游生成——两种都行，手工敲不行",
      "记住链条：请购单 → 采购订单 → 到货单 → 采购入库单 → 采购发票 → 采购结算",
    ],
    practice: "找一张已完结的历史订单，顺着看它的到货单、入库单是不是参照生成的（看有没有带出源单号）；发现手工敲的就记下来问仓库。",
    proof: "能在 U8 界面上指出「参照 / 生单」按钮在哪；并能报出最近有没有出现手工敲单导致累计入库不涨的情况。",
    minutes: 30,
    deps: ["S5-po-exec-report"],
    refs: [
      { kind: "tutorial", id: "flow-standard", label: "U8 教程 · 单据流与参照生单" },
      { kind: "card", id: "02-u8-basics", label: "02 U8 基础 §1" },
    ],
  },
  {
    id: "C3-warehouse-boundary",
    track: "collab",
    week: 8,
    title: "入库单归仓库录、仓库审（采购只核对，不越权）",
    why: "你越权去录，仓库不认这笔账，变成账实两套；或者你以为仓库会录、仓库以为你会录，货就那么躺三天没人管，生产领不出料，最后怪到采购头上。",
    learn: [
      "读 04-sop-goods-receipt 第三步，看清「谁录、谁审、采购做什么」三栏",
      "采购的动作只有两个：核对累计入库数字、催",
      "催的时候把送货单照片和订单号一起发过去——让对方不用找",
    ],
    practice: "跟仓库对接人当面把边界过一遍：到货单谁录？入库单谁录谁审？需检的料流程怎么走？把结论写成三行贴工位。",
    proof: "有那三行书面边界，且仓库对接人认可（微信回一句「对」即可，留截图）。",
    minutes: 25,
    deps: ["C1-arrival-notice"],
    refs: [{ kind: "sop", id: "04-sop-goods-receipt", label: "04 入库对接 SOP · 第三步" }],
  },
  {
    id: "C4-company-five-questions",
    track: "collab",
    week: 8,
    title: "把公司「五问 + 三补问」问清楚（第一个月收口）",
    why: "教程和 SOP 里所有带 ⚠️ 的地方，都是因为各家账套不一样。这些问题不问清，你按通用写法操作，早晚踩一次；而这些问题在入职第一个月问最自然，往后问就显得奇怪。",
    learn: [
      "五问：产品版本？走不走请购单与审批流？有没有到货单环节、启不启用质检？采购能否自审订单？跟踪报表的确切名称？",
      "三补问：现存量查询里可用量那列在贵司叫什么？手工关闭订单行你有没有权限？回签在贵司算不算必须？",
      "问谁：U8 管理员 / 采购主管 / 仓库主管，一次问不完就分两次",
    ],
    practice: "带着这八个问题去问，回来把答案填进教程和 SOP 的 ⚠️ 处，顺手把菜单树全展开截一张图。",
    proof: "八个问题全部有答案；教程里因这些答案而去掉的 ⚠️ 至少 5 处；有一张本厂 U8 菜单树全展开的截图。",
    minutes: 25,
    deps: ["S1-stock-query", "S2-save-vs-audit"],
    refs: [
      { kind: "card", id: "02-u8-basics", label: "02 U8 基础 §0 首次使用必答清单" },
      { kind: "tutorial", id: "po-query", label: "U8 教程 · 采购订单（带 ⚠️ 的路径就是要核对的）" },
    ],
  },

  // ===== 第 9 周 =====
  {
    id: "S7-receipt-and-stockin",
    track: "system",
    week: 9,
    title: "到货单 → 入库单：一张订单允许多次到货",
    why: "分批到货很常见。不懂多次到货怎么记，你要么把两批合成一张单（对不上），要么以为剩下的那批不用管（尾巴挂着）。而且到货单不填仓库，现存量里「到货/在检量」就是空的。",
    learn: [
      "看教程「到货单」「采购入库单」：订单上点「到货」→ 到货单；到货单上点「入库」→ 采购入库单",
      "一个订单允许多次到货；不合格的走退货流程",
      "到货单必须填仓库，否则「到货/在检量」列不会有数",
    ],
    practice: "跟一批实际分两次到的货，从到货单到入库单全程看一遍（不越权操作，只看和核对），把每一步的时间点记下来。",
    proof: "有一条完整的时间线记录（货到几点 / 到货单几点录 / 入库单几点审 / 累计入库几点涨），并能指出最慢的是哪一环。",
    minutes: 30,
    deps: ["S6-reference-vs-manual"],
    refs: [
      { kind: "tutorial", id: "flow-standard", label: "U8 教程 · 到货单" },
      { kind: "tutorial", id: "po-instock-query", label: "U8 教程 · 采购入库单" },
      { kind: "sop", id: "04-sop-goods-receipt", label: "04 入库对接 SOP · 第二步" },
    ],
  },
  {
    id: "C5-inspection-early",
    track: "collab",
    week: 9,
    title: "质检要提前报检，不是货到了才想起来",
    why: "需检的料到了压在待检区三天，账上没库存，生产领不出料，仓库还怪采购。而报检这件事，在发到货预告的同时顺手做掉只要一分钟。",
    learn: [
      "读 04-sop-goods-receipt 第二步里检验相关部分",
      "规则：到货预告里标了「需检」的，同一条消息同时抄送质检",
      "合格才准入库；不合格 / 让步接收都必须有书面结论",
    ],
    practice: "梳理出 152 项里哪些是需检的（新版首单、换供应商、有质量前科的），做一张需检清单；之后每次预告都按这张单勾。",
    proof: "有那张需检清单；且最近一次需检料到货，报检是在货到之前发出的（有时间戳可证）。",
    minutes: 25,
    deps: ["C1-arrival-notice"],
    refs: [{ kind: "sop", id: "04-sop-goods-receipt", label: "04 入库对接 SOP · 第二步" }],
  },
  {
    id: "V4-discrepancy",
    track: "supplier",
    week: 9,
    title: "到货差异当天定性（欠交 / 超交 / 规格不符 / 不良）",
    why: "差异拖过三天就说不清了——供应商说发够了，仓库说没收到，照片没拍，谁都不认。而且超交你自作主张收下，事后公司不认这笔账，钱谁出？",
    learn: [
      "读 04-sop-goods-receipt 第四步「差异处理」",
      "四分类各自的处理路径：欠交要补货日期、超交先请示再收、规格不符走退货、不良发明细要补货或扣款",
      "两边同步：仓库（账实一致）+ 供应商（责任归属），少一边都不算完",
    ],
    practice: "遇到的第一起差异，当天拍照留证 + 书面通知供应商（微信文字也行，要有时间戳）+ 同步仓库，全程记时间。",
    proof: "该起差异有：照片、给供应商的书面记录、给仓库的书面记录、一个明确去向（补货日期/退回/关闭行/让步接收），四样齐全。",
    minutes: 25,
    deps: ["S7-receipt-and-stockin"],
    refs: [{ kind: "sop", id: "04-sop-goods-receipt", label: "04 入库对接 SOP · 第四步" }],
  },

  // ===== 第 10 周 =====
  {
    id: "S8-amend-and-unaudit",
    track: "system",
    week: 10,
    title: "改单要先弃审，且下游已生成就改不动",
    why: "发现填错了硬改，改不动就重开一张——同一批货两张订单，库存和对账全乱，而且两张单都在报表上挂着，你的在途数据从此不可信。",
    learn: [
      "顺序：弃审 → 修改 → 重新审核；下游（到货单/入库单）已生成的，得先处理下游",
      "月末结账后，已结账月份的入库单和发票不可改也不可删",
      "改不动时的正确做法不是重开一张，是问主管走什么流程（变更单 / 关行 / 红字冲销）",
    ],
    practice: "找一张需要改的单（数量或交期变了），走一次完整的弃审—改—审；改不动的记录卡在哪一步、下游是什么单据。",
    proof: "能复述本厂改单的完整路径，包括「下游已生成时找谁、走什么流程」这一句；有一次实际操作或一次书面咨询结论。",
    minutes: 30,
    deps: ["S4-po-create", "S7-receipt-and-stockin"],
    refs: [
      { kind: "tutorial", id: "po-query", label: "U8 教程 · 弃审与修改订单" },
      { kind: "card", id: "02-u8-basics", label: "02 U8 基础 §2" },
    ],
  },
  {
    id: "S9-close-line",
    track: "system",
    week: 10,
    title: "手工关闭订单行（尾数不再交付要主动关）",
    why: "报表里挂着一堆永远到不了的在途尾巴，越积越多，最后这张报表没人信，你的在途数据也就废了——而在途数据是你算缺口的两个输入之一。",
    learn: [
      "什么时候关：供应商明确不补的欠交尾数、已作废的需求、长期无进展的行",
      "关之前先确认权限：这个动作你有没有？没有找谁",
      "月结时系统会弹一句「是否要进行订单关闭」，那是提醒你去清尾巴",
    ],
    practice: "把所有超过 30 天没动静的订单行列出来，逐条判「还要 / 不要」，不要的走关闭（或申请关闭）。",
    proof: "有一份僵尸在途清单和处理结论；处理后订单执行统计表里 30 天以上未动的行数明显下降，能报出前后两个数字。",
    minutes: 25,
    deps: ["S5-po-exec-report"],
    refs: [
      { kind: "tutorial", id: "po-list", label: "U8 教程 · 关闭订单行" },
      { kind: "sop", id: "05-sop-tracking", label: "05 订单跟踪 SOP §5 生命周期收尾" },
    ],
  },
  {
    id: "B11-price-validity",
    track: "basics",
    week: 10,
    title: "报价有效期与询比价基本盘",
    why: "拿着三个月前的报价下单，供应商到时候说涨价了，你没有立场；或者你一直用老价，其实市场早跌了，公司多花的钱记在采购账上。",
    learn: [
      "读 01-skill-tree §2.1「询比价与议价」",
      "报价有效期（quote_valid_days）过了就要重询，这是流程不是得罪人",
      "比价要比同口径：含税/不含税、含不含运费、MOQ 是否相同",
    ],
    practice: "查一遍两家供应商现行报价的日期，过期的发一封重询邮件（列清物料、数量档、要求回复日期）。",
    proof: "有一份现行价格表带「报价日期 / 有效期至」两列；过期项已发出重询且有回复或跟进记录。",
    minutes: 25,
    deps: ["B5-tax-basis"],
    refs: [{ kind: "card", id: "01-skill-tree", label: "01 技能树 §2.1" }],
  },

  // ===== 第 11 周 =====
  {
    id: "V5-chase-three-times",
    track: "supplier",
    week: 11,
    title: "同一件事催三次没结果就换轨，不催第四次",
    why: "一直用同一个已经失效的方法加力气，人累了事没动，还落个「催不动」的印象。三次是分界线：前三次用电话保关系，第四次换书面保自己。",
    learn: [
      "每通催货电话必问三样：为什么晚 / 新交期哪天 / 现在货到哪一步了——缺一样等于没打",
      "跟进记录格式：日期 + 对方姓名 + 原话 + 新交期",
      "打不通或推诿的不打第二遍，直接换轨",
    ],
    practice: "给当前所有逾期单各打一通电话，严格按三问来，记录按四要素写；同时统计每单已经催了第几次。",
    proof: "每条逾期记录都含四要素；能报出哪几单已经到了「第三次」这条线、下一步换什么轨。",
    minutes: 30,
    deps: ["V2-shipped-three-things"],
    refs: [{ kind: "sop", id: "05-sop-tracking", label: "05 订单跟踪 SOP §3" }],
  },
  {
    id: "V6-escalation-writing",
    track: "supplier",
    week: 11,
    title: "换轨的书面写法：邮件、抄送、截止时间",
    why: "换轨不是发火，是换一种有留痕、有对方上级在场、有截止时间的表达。写不好就变成情绪，关系伤了事还是没动；写好了对方内部自己就会推。",
    learn: [
      "结构四段：事实（订单号/数量/原定日期）+ 已做过什么（三次电话的日期）+ 明确要求（几号几点前书面回复）+ 后果（启动备选/按合同处理）",
      "抄送名单：对方销售上级（supplier_file 里的 escalation_contact）+ 自己领导",
      "读采姐给的两段范文（T4 催签 / T8 催货），照着改人名和单号",
    ],
    practice: "对一条真实的第三次未果的单，写一封换轨邮件，先给采姐/主管看一眼再发。",
    proof: "有那封已发出的邮件（含抄送名单和截止时间），以及对方在截止时间前后的回应记录。",
    minutes: 25,
    deps: ["V5-chase-three-times", "V3-supplier-file"],
    refs: [{ kind: "sop", id: "05-sop-tracking", label: "05 订单跟踪 SOP §3" }],
  },
  {
    id: "C6-delay-notify-same-day",
    track: "collab",
    week: 11,
    title: "延误必须当天通知生产，不能自己扛着等好消息",
    why: "生产不知道就照常排产，到当天开不了线，小延误变成停线事故——而复盘时责任全在「没说」的那个人。扛着等好消息是新人最贵的一个习惯。",
    learn: [
      "规则：知道延误的当天就说，哪怕还没有新交期，也说「我在追，最晚明天上午给你确切日期」",
      "说的内容三段：影响什么（哪个料、哪天、缺多少）+ 我已经做了什么 + 需要你怎么配合",
      "读 05-sop-tracking §4「每周汇总」里给生产的交付物格式",
    ],
    practice: "遇到的下一次延误，当天下班前书面通知生产计划（微信/邮件都行），并抄送自己领导。",
    proof: "有那条通知的时间戳，且时间戳与你得知延误的时间在同一天；生产有回应记录。",
    minutes: 30,
    deps: ["V5-chase-three-times"],
    refs: [{ kind: "sop", id: "05-sop-tracking", label: "05 订单跟踪 SOP §4" }],
  },

  // ===== 第 12 周 =====
  {
    id: "C7-choice-not-question",
    track: "collab",
    week: 12,
    title: "要答复时给选择题，不给问答题",
    why: "问「这个怎么办」→ 没人回，你就一直等，最后事情烂在你手里。给「A 方案 / B 方案 + 不回复默认走 A + 截止时间」→ 当天就有答案。这是逼决策最有效的一招，而且不得罪人。",
    learn: [
      "模板：现状一句 + 方案 A（代价）+ 方案 B（代价）+ 我的建议 + 「X 点前没回复我按 A 办」",
      "给默认值是关键——没有默认值的选择题还是会被拖",
      "读采姐 T1-B / T3 / T9 三段升级话术，注意它们都有截止时间",
    ],
    practice: "把这周需要别人拍板的两件事，都改写成选择题发出去（一件给生产，一件给领导）。",
    proof: "两条已发出的选择题消息（含默认值和截止时间），以及各自的回复时间——对比一下比你以前问「怎么办」快了多少。",
    minutes: 30,
    deps: ["C6-delay-notify-same-day"],
    refs: [{ kind: "sop", id: "03-sop-place-order", label: "03 下单 SOP · 场景2 加单" }],
  },
  {
    id: "V7-approval-before-promise",
    track: "supplier",
    week: 12,
    title: "加急、超收、改价都要先请示再答应",
    why: "私下答应加价 15%，事后领导不认——钱谁出、责任谁担？超授权承诺是红线，第一次踩就把信用赔进去，而且这类事没有「下不为例」。",
    learn: [
      "三类要请示的：加急费、超收（多到的货收不收）、改价",
      "请示格式：金额 + 不做的后果 + 我的建议，让领导只需要回一个字",
      "对供应商的标准话术：「这个我得报一下，明天上午给你准信」——不丢面子，也不越权",
    ],
    practice: "把本厂的授权边界问清楚（多少钱以内你能定？超收多少比例可以收？），写成三行贴工位；遇到就照着走一次。",
    proof: "有那三行书面授权边界（主管认可）；且最近一次涉及加价/超收的事，有请示记录和书面批复。",
    minutes: 30,
    deps: ["V4-discrepancy"],
    refs: [{ kind: "card", id: "01-skill-tree", label: "01 技能树 §4 红线" }],
  },
  {
    id: "B13-red-lines",
    track: "basics",
    week: 12,
    title: "红线：一条都不能碰",
    why: "业务能力可以慢慢长，红线踩一次就没有第二次。而新人踩红线往往不是贪，是不知道——比如替人转发报价、把别家的价格告诉这家、私下答应一件小事。",
    learn: [
      "读 01-skill-tree §4「红线」全节",
      "重点五条：超授权承诺、泄露比价信息、收供应商好处、维护第二套账、无书面授权就下加单",
      "遇到擦边的情况，标准动作是「我问一下」而不是自己判断",
    ],
    practice: "把红线抄一遍（手抄，不是复制），旁边各写一句「我可能会在什么场景下不小心碰到它」。",
    proof: "那张手抄的红线单，每条后面都有一个自己想出来的具体场景。",
    minutes: 20,
    refs: [{ kind: "card", id: "01-skill-tree", label: "01 技能树 §4 红线" }],
  },

  // ===== 第 13 周 =====
  {
    id: "S10-provisional-estimate",
    track: "system",
    week: 13,
    title: "暂估入库（货到票未到）",
    why: "月底财务来催票，你以为是自己漏了什么，慌。实际上入库和发票本来就可以不在同一个月，你只要配合追票就行——不懂这个，每个月底都要白慌一次。",
    learn: [
      "U8 三种暂估方式：月初回冲 / 单到回冲 / 单到补差（差别属财务口，知道有这回事即可）",
      "采购只需要记住一句：入库和发票不在同一个月不影响你收货",
      "月底配合财务做的事：拉「入库未开票」清单，逐家催票",
    ],
    practice: "月底前拉一次本月入库未开票清单，按供应商分组，各发一条催票消息。",
    proof: "有那份清单和两条已发出的催票记录；能说出本月暂估挂了多少金额。",
    minutes: 30,
    deps: ["S7-receipt-and-stockin"],
    refs: [
      { kind: "tutorial", id: "flow-provision", label: "U8 教程 · 暂估（货到票未到）" },
      { kind: "card", id: "01-skill-tree", label: "01 技能树 §1.3 单据与对数常识" },
    ],
  },
  {
    id: "S11-invoice-recon",
    track: "system",
    week: 13,
    title: "月度对账：订单 = 入库单 = 发票，三个数对上",
    why: "差异行跨月就变成陈年旧账，谁都不认了。而对账对不上时，最后核对成本几乎总是落在采购身上——因为只有你手里有下单时的原始口径。",
    learn: [
      "三单匹配的意思：订单数量 / 累计入库 / 已开票量三个数字对得上才交财务",
      "对账重点看三样：数量、单价、含税口径（口径不同就会差 13%）",
      "差异行当月谈定，绝不跨月",
    ],
    practice: "做一次本月对账：拉入库明细，跟供应商对账单逐行核，差异行单列并当月内谈定。",
    proof: "本月对账单有双方确认（回签或邮件），差异行清零或每行有书面处理结论，已交财务且记了交接时间。",
    minutes: 30,
    deps: ["S10-provisional-estimate", "B5-tax-basis"],
    refs: [
      { kind: "tutorial", id: "flow-standard", label: "U8 教程 · 采购综合统计表 / 结算余额表" },
      { kind: "card", id: "01-skill-tree", label: "01 技能树 §1.3" },
    ],
  },
  {
    id: "C8-finance-handover",
    track: "collab",
    week: 13,
    title: "跟财务的交接口径",
    why: "交过去的资料缺一样，财务就退回来，一来一回一周过去，付款批次赶不上，供应商下个月开始拖你的货——一个纯流程问题最后变成供货问题。",
    learn: [
      "问清财务要什么：对账单原件？回签？入库单号清单？截止哪天交？",
      "记住付款节奏是你的筹码：「赶不上这批就顺延一个月」这句话比催十遍有用",
      "交接要记时间，交出去的东西要有清单",
    ],
    practice: "当面问财务对接人要一份「采购每月要交什么、什么时候交」的清单，抄下来贴工位。",
    proof: "有那份清单（财务认可），且本月交接有一条带日期的记录。",
    minutes: 25,
    deps: ["S11-invoice-recon"],
    refs: [{ kind: "card", id: "01-skill-tree", label: "01 技能树 §1.4 内部协作界面" }],
  },

  // ===== 第 14 周 =====
  {
    id: "V8-performance-record",
    track: "supplier",
    week: 14,
    title: "供应商的每次表现都要有记录",
    why: "年底评供应商时全凭印象，你说不出任何数字，你的判断在会上就没有分量。而记录这件事只能日拱一卒——年底再补，补不出来。",
    learn: [
      "每张单要留的四个事实：承诺日 / 实际到货日 / 数量是否一致 / 有没有质量问题",
      "记录的时机是事情发生的当天，不是月底",
      "读 07-kpi-and-reporting，看哪些指标是从这些原始记录长出来的",
    ],
    practice: "补齐近 90 天所有已完结订单的这四个字段（缺的从跟单表和微信里翻），做成一张原始记录表。",
    proof: "近 90 天订单的四字段完整率 ≥ 90%；能报出这三个月一共有几单逾期、分别是哪家。",
    minutes: 30,
    deps: ["V4-discrepancy"],
    refs: [{ kind: "card", id: "07-kpi-and-reporting", label: "07 KPI 与汇报" }],
  },
  {
    id: "V9-ontime-rate",
    track: "supplier",
    week: 14,
    title: "准交率、不良率怎么算",
    why: "「这家老拖」是印象，「近 90 天准交率 78%，行业惯例 95%」是证据。前者在会上没人听，后者能直接推动换供应商或加备选。这也是优先级公式里 f_supplier 那 8 分的输入。",
    learn: [
      "准交率 = 按承诺日（含宽限）到货的订单行数 ÷ 总订单行数，窗口取近 90 天",
      "不良率 = 不良数量 ÷ 到货数量；两个指标都要注明统计窗口",
      "没有数据时默认按 0.5 的风险算——不知道不等于没风险",
    ],
    practice: "用上一条的原始记录，算出两家供应商近 90 天的准交率和不良率，各写一句解读。",
    proof: "两家供应商各有一组带窗口标注的数字；能说出哪家风险更高、高在哪一类（交期 or 质量）。",
    minutes: 25,
    deps: ["V8-performance-record"],
    refs: [{ kind: "card", id: "07-kpi-and-reporting", label: "07 KPI 与汇报" }],
  },
  {
    id: "B14-one-main-one-backup",
    track: "basics",
    week: 14,
    title: "一主一备：把风险项识别出来",
    why: "152 项料里只有一家能供的那些，就是你的单点故障。平时没事，出事那天（对方停产/涨价/质量事故）你一点余地都没有，而备选供应商不是当天能找到的。",
    learn: [
      "规则：backup_supplier_code 为空 = 风险项",
      "优先给日配件和高金额料找备选，其余的排期慢慢来",
      "找备选不等于马上换，先做小批量试样，把口径和质量摸一遍",
    ],
    practice: "筛出所有备选为空的料，按「日配 / 高金额 / 其他」分三档，给前两档各写一条备选开发建议交主管。",
    proof: "有那份风险项清单（带三档分类）和一份交给主管的备选开发建议（有提交记录）。",
    minutes: 25,
    deps: ["V3-supplier-file"],
    refs: [{ kind: "card", id: "01-skill-tree", label: "01 技能树 §2.2" }],
  },

  // ===== 第 15 周 =====
  {
    id: "C9-report-to-boss",
    track: "collab",
    week: 15,
    title: "当天一条消息 + 周五三句话周报",
    why: "拦下的断料没人知道，就等于没发生。采购这行做得好是「什么都没出事」，不主动说，年底考评时你拿不出任何东西——而这不是邀功，是让领导知道该在哪里支持你。",
    learn: [
      "当天一条消息格式：发生了什么 + 我做了什么 + 结果（三句，不超过五行）",
      "周五三句话周报：本周做成的一件事 / 下周最要盯的一件事 / 需要您拍板的一件事（没有就写「无」）",
      "先说结论，再说已经做了什么，最后才是求助——这个顺序对领导最省心",
    ],
    practice: "本周做成一件具体的事就当天发一条；周五发一次三句话周报。目标是连发 8 周不断。",
    proof: "有当周的消息记录和周报记录；开始记连续周数（第 1 周）。",
    minutes: 25,
    refs: [{ kind: "card", id: "07-kpi-and-reporting", label: "07 KPI 与汇报" }],
  },
  {
    id: "C10-monthly-supplier-note",
    track: "collab",
    week: 15,
    title: "一页纸供应商观察（月度）",
    why: "这是把你的日常记录变成「判断」的地方，也是设计出身的优势能露出来的地方——别人给一堆数字，你能给出结构和取舍建议。只当苦活干，就永远是执行；写成观察，才是专业壁垒。",
    learn: [
      "结构：数字（准交率/不良率/逾期次数）+ 三件具体的事 + 一个建议 + 一个需要拍板的问题",
      "一页纸，不超过一页——超了说明你没想清楚",
      "读 07-kpi-and-reporting 里的汇报模板",
    ],
    practice: "用第 14 周算出的数字，写出第一份一页纸供应商观察，交给主管。",
    proof: "那份一页纸已交出且有反馈；反馈里如果有「这个我没想到」这类话，记下来。",
    minutes: 30,
    deps: ["V9-ontime-rate", "C9-report-to-boss"],
    refs: [{ kind: "card", id: "07-kpi-and-reporting", label: "07 KPI 与汇报" }],
  },
  {
    id: "S12-export-to-excel",
    track: "system",
    week: 15,
    title: "U8 导出到 Excel 的坑",
    why: "每天导两张表是你的数据入口。导出格式一变、列名一改，你后面的算式就全废；而多数人被卡住时不知道是导出的问题，会以为是自己算错了。",
    learn: [
      "看教程「导出到 Excel」：列表/报表界面工具栏 → 输出（有的界面叫导出）",
      "常见坑：编码被存成数字丢前导零、合并单元格、表头有两行、导出的是当前页不是全部",
      "固定下来：每次导出用同样的过滤条件和同样的列，存成同样的文件名格式",
    ],
    practice: "把每天要导的两张表的导出步骤写成一张操作卡（含过滤条件、勾哪些列、存哪个目录、文件名格式）。",
    proof: "有那张操作卡；照着它导出的文件能被小采一次导入成功（不需要手工改列名）。",
    minutes: 25,
    deps: ["S5-po-exec-report"],
    refs: [{ kind: "tutorial", id: "export-excel", label: "U8 教程 · 导出到 Excel" }],
  },

  // ===== 第 16 周 =====
  {
    id: "B15-self-map",
    track: "basics",
    week: 16,
    title: "把 20 条盲区画成自己的地图",
    why: "学过不等于变成本事。四个月过去，哪些已经是肌肉记忆、哪些还要查资料、哪些其实还没真遇到过——分不清这三档，你会在最不该虚的地方虚。",
    learn: [
      "把 20 条盲区列出来，每条标一档：肌肉记忆 / 要查一下 / 还没真遇到过",
      "「还没真遇到过」的不是弱项，是要留意的场景，遇到时提前翻资料",
      "这一条没有对错，是给自己看的",
    ],
    practice: "花 25 分钟做完这张自评表，把「要查一下」的那几条对应的资料位置写在旁边（方便下次三秒找到）。",
    proof: "一张 20 行三档的自评表，「要查一下」的每行都写了资料位置。",
    minutes: 25,
    deps: ["B13-red-lines", "B12-priority-model"],
    refs: [{ kind: "card", id: "01-skill-tree", label: "01 技能树（全）" }],
  },
  {
    id: "C11-handover-doc",
    track: "collab",
    week: 16,
    title: "给自己写一份岗位交接文档",
    why: "上一任离职没留下东西，所以你这四个月踩的坑基本都是重新踩的。写这份文档一半是为下一任，另一半是为你自己——能写清楚的事，才是真的会了。",
    learn: [
      "结构：我负责什么（152 项 / 2 家 / 5 项日配）+ 每天的固定节奏 + 每个月的固定动作 + 各方对接人 + 已知的坑",
      "把这四个月里问出来的答案（五问三补问、各种边界）都收进去",
      "写完请采姐或主管看一遍，看有没有「你没写但很重要」的",
    ],
    practice: "写出第一版交接文档，找一个人看并提意见，改一版。",
    proof: "文档已完成且经他人评审有修改痕迹；里面能查到公司五问的答案和三条边界（仓库/财务/授权）。",
    minutes: 25,
    deps: ["C4-company-five-questions", "C8-finance-handover", "C3-warehouse-boundary"],
    refs: [{ kind: "card", id: "00-job-map", label: "00 岗位地图" }],
  },
  {
    id: "V10-annual-review",
    track: "supplier",
    week: 16,
    title: "供应商评审：用数字说话",
    why: "评审会上，凭印象说话的人会被有数字的人覆盖。你手里有近 90 天的原始记录和两个指标——这时候你的判断才有分量，而这正是「谁都绕不开你」的开始。",
    learn: [
      "评审四维：交期（准交率）/ 质量（不良率）/ 配合度（响应时长、回签及时率）/ 价格（同口径比价）",
      "每个结论后面挂一个数字和一个具体事件",
      "结论要给动作：继续 / 观察 / 加备选 / 降量，四选一",
    ],
    practice: "对两家供应商各做一次四维评审，给出四选一的动作建议，交主管。",
    proof: "两份评审结论（每维有数字 + 事件 + 动作建议），已提交并有反馈。",
    minutes: 25,
    deps: ["V9-ontime-rate", "C10-monthly-supplier-note"],
    refs: [{ kind: "card", id: "07-kpi-and-reporting", label: "07 KPI 与汇报" }],
  },
];

// ---------------------------------------------------------------------------
// 章节
// ---------------------------------------------------------------------------

export const CHAPTERS: Chapter[] = [
  {
    id: "ch-basics-1",
    track: "basics",
    name: "算账的口径",
    goal: "能独立算出净缺口和最晚下单日，且知道每个输入的坑在哪。",
    items: [
      "B1-available-qty",
      "B2-effective-intransit",
      "B3-lead-time-calendar",
      "B4-moq-vs-pack",
      "B5-tax-basis",
      "B6-coverage-days",
      "B7-backward-schedule",
      "B8-net-gap",
    ],
  },
  {
    id: "ch-basics-2",
    track: "basics",
    name: "一张挑不出毛病的单",
    goal: "订单要素齐、口径清、价格有依据。",
    items: ["B9-po-ten-elements", "B10-code-and-unit", "B11-price-validity"],
  },
  {
    id: "ch-basics-3",
    track: "basics",
    name: "排序、红线与自我盘点",
    goal: "知道先做哪个、哪些绝对不能碰、自己还缺什么。",
    items: ["B12-priority-model", "B13-red-lines", "B14-one-main-one-backup", "B15-self-map"],
  },
  {
    id: "ch-system-1",
    track: "system",
    name: "查得准",
    goal: "U8 里的数字你能自己查出来、并能解释口径差异。",
    items: ["S1-stock-query", "S3-intransit-three-views", "S5-po-exec-report", "S12-export-to-excel"],
  },
  {
    id: "ch-system-2",
    track: "system",
    name: "开得对",
    goal: "单据从上游拉、审核后才生效——数据链不断。",
    items: ["S2-save-vs-audit", "S4-po-create", "S6-reference-vs-manual"],
  },
  {
    id: "ch-system-3",
    track: "system",
    name: "改得动、收得掉",
    goal: "错了知道怎么改，尾巴知道怎么关，报表不积垃圾。",
    items: ["S7-receipt-and-stockin", "S8-amend-and-unaudit", "S9-close-line"],
  },
  {
    id: "ch-system-4",
    track: "system",
    name: "月末对得上",
    goal: "暂估、对账、三单匹配，月底不慌。",
    items: ["S10-provisional-estimate", "S11-invoice-recon"],
  },
  {
    id: "ch-collab-1",
    track: "collab",
    name: "给仓库和质检的接口",
    goal: "预告、边界、报检三件事固定下来，货不再躺在门口。",
    items: ["C1-arrival-notice", "C3-warehouse-boundary", "C5-inspection-early"],
  },
  {
    id: "ch-collab-2",
    track: "collab",
    name: "给生产的接口",
    goal: "节奏自己定、延误当天说、要答复给选择题。",
    items: ["C2-daily-rhythm", "C6-delay-notify-same-day", "C7-choice-not-question"],
  },
  {
    id: "ch-collab-3",
    track: "collab",
    name: "给领导和财务的接口",
    goal: "问清边界、交清资料、让做成的事被看见。",
    items: [
      "C4-company-five-questions",
      "C8-finance-handover",
      "C9-report-to-boss",
      "C10-monthly-supplier-note",
      "C11-handover-doc",
    ],
  },
  {
    id: "ch-supplier-1",
    track: "supplier",
    name: "让承诺落地",
    goal: "回签、运单号、档案——把口头变成可追的事实。",
    items: ["V1-signback", "V2-shipped-three-things", "V3-supplier-file"],
  },
  {
    id: "ch-supplier-2",
    track: "supplier",
    name: "出问题怎么办",
    goal: "差异当天定性、催三次换轨、越权的先请示。",
    items: ["V4-discrepancy", "V5-chase-three-times", "V6-escalation-writing", "V7-approval-before-promise"],
  },
  {
    id: "ch-supplier-3",
    track: "supplier",
    name: "把供应商管起来",
    goal: "用数字说话，从执行者变成有判断的人。",
    items: ["V8-performance-record", "V9-ontime-rate", "V10-annual-review"],
  },
];

// ---------------------------------------------------------------------------
// 查询函数
// ---------------------------------------------------------------------------

const BY_ID = new Map(ITEMS.map((i) => [i.id, i] as const));
const INDEX_OF = new Map(ITEMS.map((i, idx) => [i.id, idx] as const));

export function itemById(id: string): LearningItem | undefined {
  return BY_ID.get(id);
}

export function chapterOf(itemId: string): Chapter | undefined {
  return CHAPTERS.find((c) => c.items.includes(itemId));
}

export const TOTAL_WEEKS = 16;
/** 每周的时间预算上限——她要上班，排满就等于排空 */
export const WEEKLY_MINUTES_CAP = 90;

export interface WeekPlan {
  week: number;
  theme: string;
  items: LearningItem[];
  totalMinutes: number;
}

/** 按周排布；1..16 全部返回（即使某周为空也占位，便于时间轴渲染） */
export function planByWeek(): WeekPlan[] {
  const out: WeekPlan[] = [];
  for (let w = 1; w <= TOTAL_WEEKS; w++) {
    const items = ITEMS.filter((i) => i.week === w).sort(
      (a, b) => (INDEX_OF.get(a.id) ?? 0) - (INDEX_OF.get(b.id) ?? 0),
    );
    out.push({
      week: w,
      theme: WEEK_THEMES[w] ?? `第 ${w} 周`,
      items,
      totalMinutes: items.reduce((s, i) => s + i.minutes, 0),
    });
  }
  return out;
}

export interface TrackReadiness {
  track: Track;
  done: number;
  total: number;
  /** 还差的（未完成条目标题，按周次排序，最多 3 条）——不是扣分，是"下一步看这里" */
  gaps: string[];
}

/** 每条 track 的完成度。gaps 最多给 3 条，多了就成了压力清单 */
export function readiness(done: Set<string>): TrackReadiness[] {
  return TRACKS.map(({ id }) => {
    const items = ITEMS.filter((i) => i.track === id);
    const undone = items
      .filter((i) => !done.has(i.id))
      .sort((a, b) => a.week - b.week || (INDEX_OF.get(a.id) ?? 0) - (INDEX_OF.get(b.id) ?? 0));
    return {
      track: id,
      done: items.length - undone.length,
      total: items.length,
      gaps: undone.slice(0, 3).map((i) => i.title),
    };
  });
}

/**
 * 下一步学什么。拓扑序：只返回前置全部完成的条目，按周次排。
 * 默认一次最多 3 条——多了她就不看了。
 */
export function nextUp(done: Set<string>, limit = 3): LearningItem[] {
  return ITEMS.filter((i) => !done.has(i.id) && (i.deps ?? []).every((d) => done.has(d)))
    .sort((a, b) => a.week - b.week || (INDEX_OF.get(a.id) ?? 0) - (INDEX_OF.get(b.id) ?? 0))
    .slice(0, Math.max(0, limit));
}

/** 某条目的前置里还没完成的（用于卡片上的锁形提示；不硬拦，只提示） */
export function blockedBy(item: LearningItem, done: Set<string>): LearningItem[] {
  return (item.deps ?? []).filter((d) => !done.has(d)).map((d) => BY_ID.get(d)!).filter(Boolean);
}
