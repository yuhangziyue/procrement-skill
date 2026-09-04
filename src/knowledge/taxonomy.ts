// 采购知识体系的「骨架」：分类之下，一个能自己上手干活的采购专员，知识库里到底该有哪些东西。
//
// classify.ts 回答的是「这段文字属于哪一类」——那是分拣。
// 这里回答的是「这一类里该有哪几条，缺了哪条会出事」——那是体系。两件事，别混。
//
// 三个设计口径：
//   1) 主题是「具体到能判断有没有」的，不是「下单与算量」这种筐。判据写在 satisfiedBy 里，
//      纯关键词命中 + 最少切片数，跟 classify 一样不调模型——采购词汇封闭，规则表够用。
//   2) required 只给「缺了会直接做错事、赔钱、被审计」的主题。非必备的缺失只提示、不报警，
//      否则一个新库开机就是四十条红字，人就直接把提醒关了。
//   3) 关联必须双向且带类型。四种类型见 RelationKind；其中 contrast（易混对照）对新人最值钱——
//      「现存量 ↔ 可用量」「到货 ↔ 入库」「请购单 ↔ 采购订单」这种，错一次就是一次事故。
//
// 关联在 RELATIONS 里单向声明一次，TOPICS 的 relatedTo / relationKind 由它推出来，
// 保证两边永远对得上（手写两边迟早漂）。prerequisite 与 downstream 互为反向，contrast / same-doc 自反。

import type { CategoryId } from "./classify";

/**
 * 四种逻辑关联。方向读法：以「持有这条 relationKind 的主题」为主语。
 *  - prerequisite：对方是我的前置，不懂它就看不懂我（可用量 → 净缺口）
 *  - downstream  ：对方在我的下游，我出问题它跟着遭殃（订单交期 → 生产排产）
 *  - contrast    ：易混对照，两个概念长得像但不是一回事（现存量 ↔ 可用量）
 *  - same-doc    ：通常写在同一份制度/文件里，找一份就能一起补齐
 */
export type RelationKind = "prerequisite" | "contrast" | "downstream" | "same-doc";

export const RELATION_LABEL: Record<RelationKind, string> = {
  prerequisite: "前置",
  contrast: "易混对照",
  downstream: "下游影响",
  "same-doc": "同一份文件",
};

/** prerequisite ↔ downstream 互为反向；contrast / same-doc 反过来还是自己 */
const INVERSE: Record<RelationKind, RelationKind> = {
  prerequisite: "downstream",
  downstream: "prerequisite",
  contrast: "contrast",
  "same-doc": "same-doc",
};

export interface TopicSpec {
  /** 稳定 id，形如 "ordering.available-qty"，前缀 = category */
  id: string;
  /** 复用 classify.ts 的 10 类 */
  category: CategoryId;
  name: string;
  /** 缺了会出什么事——写具体后果，不写「很重要」 */
  why: string;
  /** 必备（缺失报警）还是建议（缺失只提示） */
  required: boolean;
  /** 什么算「这条有了」 */
  satisfiedBy: {
    /** 文档里出现这些词才算命中；同义词写足，宁可多不可漏 */
    keywords: string[];
    /** 至少要有几个切片命中，默认 1；写 2 的是「一句话带过不算数」的主题 */
    minChunks?: number;
  };
  /** 缺失时给用户看的一句人话：去要哪份文件、找谁要 */
  askIfMissing: string;
  /** 有逻辑关联的主题 id（由 RELATIONS 双向推出） */
  relatedTo: string[];
  /** 每条关联是哪一类（由 RELATIONS 推出，反向自动取 INVERSE） */
  relationKind: Record<string, RelationKind>;
}

export interface TopicRelation {
  from: string;
  to: string;
  kind: RelationKind;
}

type TopicSeed = Omit<TopicSpec, "relatedTo" | "relationKind">;

const SEEDS: TopicSeed[] = [
  // ---------- 岗位基础 ----------
  {
    id: "basics.5r",
    category: "basics",
    name: "5R 与采购的价值边界",
    why: "只盯价格的采购迟早会买回一堆便宜但交不了期、进不了产线的料，被追责时说不清自己按什么标准做的决定。",
    required: false,
    satisfiedBy: { keywords: ["5r", "合适的价格", "合适的数量", "合适的时间", "合适的质量", "qcds", "质量成本交期", "采购的价值"] },
    askIfMissing: "知识库里没有一条讲「采购到底在权衡什么」的内容 —— 把公司内训的采购入门课件、或者你入职时那份岗位说明书导进来，哪怕是一页纸。",
  },
  {
    id: "basics.three-way-match",
    category: "basics",
    name: "三单匹配（订单-入库-发票）",
    why: "三单对不上就付款，等于替供应商的多发、错发买单，年底审计第一个查这个。",
    required: true,
    satisfiedBy: { keywords: ["三单匹配", "订单入库发票", "单据核对", "三方核对", "订单 入库 发票", "数量金额核对"] },
    askIfMissing: "知识库里查不到「三单匹配」怎么做 —— 找财务要一份应付结算流程说明，或者把你们请款单背面那张核对清单拍下来导进来。",
  },
  {
    id: "basics.role-boundary",
    category: "basics",
    name: "采购的职责边界",
    why: "算需求、定安全库存、判合格与否，这三件事只要边界不清，出事时永远是采购背锅。",
    required: false,
    satisfiedBy: { keywords: ["职责边界", "岗位职责", "谁负责", "不归采购", "分工", "职责划分", "工作范围"] },
    askIfMissing: "知识库里没有写清「哪些事不归采购」 —— 找主管要一份部门职责说明或岗位说明书；没有成文的，就把你和计划/仓库最近一次扯皮的结论写成一段导进来。",
  },

  // ---------- 系统操作(U8) ----------
  {
    id: "u8.login-account",
    category: "u8",
    name: "账套、登录与权限范围",
    why: "选错账套录的单在正确账套里根本不存在，等发现时货已经在路上了。",
    required: true,
    satisfiedBy: { keywords: ["账套", "登录u8", "系统管理", "操作员", "权限", "登录系统"] },
    askIfMissing: "知识库里没有 U8 的登录与账套说明 —— 找系统管理员要一份「新账号开通说明」，里面通常写了账套号、服务器地址和你这个岗位能看到哪些菜单。",
  },
  {
    id: "u8.stock-query",
    category: "u8",
    name: "现存量查询各列怎么看",
    why: "看错一列就多下一批货，仓库爆仓、资金压死，还查不出是哪一步错的。",
    required: true,
    satisfiedBy: { keywords: ["现存量查询", "现存量", "库存查询", "结存数量", "仓库存量", "存量表"] },
    askIfMissing: "知识库里没有现存量查询的说明 —— 打开 U8 的「现存量查询」把整屏截下来，让老采购或系统管理员逐列标注一句「这列是什么」，存成一份文档导进来。",
  },
  {
    id: "u8.po-entry",
    category: "u8",
    name: "采购订单录入、审核与弃审",
    why: "订单没审核等于不存在，供应商发了货你系统里查无此单；已审核的单要改却不会弃审，就会出现两张重复订单。",
    required: true,
    satisfiedBy: { keywords: ["采购订单", "录入订单", "审核单据", "弃审", "表体", "表头", "订单保存"], minChunks: 2 },
    askIfMissing: "知识库里没有采购订单的完整录入步骤 —— 让老采购带你走一遍并全程截图（新增/表头/表体/保存/审核/弃审各一张），配上文字存成 SOP 导进来。",
  },
  {
    id: "u8.reference-generate",
    category: "u8",
    name: "参照生单（订单→到货→入库）",
    why: "不会参照就只能手工重录，数量单价一敲错，后面对账全乱，而且系统里两张单挂不上钩。",
    required: false,
    satisfiedBy: { keywords: ["参照生成", "参照订单", "参照生单", "生单", "参照采购订单"] },
    askIfMissing: "知识库里没有讲参照生单 —— 找老采购要一份「到货单/入库单怎么从订单参照过来」的截图步骤，这是省时间最多的一个操作，值得单独存一份。",
  },

  // ---------- 下单与算量 ----------
  {
    id: "ordering.available-qty",
    category: "ordering",
    name: "可用量的口径",
    why: "把现存量当可用量下单，就是把别人已经占掉的货又算了一遍，该买的没买、不该买的堆一仓库。",
    required: true,
    satisfiedBy: { keywords: ["可用量", "可用库存", "已分配", "占用量", "预计可用", "可用数量", "待发量"] },
    askIfMissing: "知识库里没写清「可用量」怎么算 —— 找系统管理员或计划部要一句话口径：可用量 = 现存量 − 哪几项？把这句话连同他们算缺料那张表的列头说明一起导进来。",
  },
  {
    id: "ordering.net-shortage",
    category: "ordering",
    name: "净缺口的算法",
    why: "净缺口算错，要么停线待料，要么多买一堆呆料，这是采购最常见也最贵的一类错。",
    required: true,
    satisfiedBy: { keywords: ["净需求", "净缺口", "缺料计算", "毛需求", "缺口数量", "需求减库存", "安全库存"], minChunks: 2 },
    askIfMissing: "知识库里没有净缺口的算法 —— 找计划部要一份缺料表样例，让他们在旁边写清每一列怎么来的（需求、在库、在途、安全库存各减了什么），连表带说明导进来。",
  },
  {
    id: "ordering.moq",
    category: "ordering",
    name: "MOQ 起订量",
    why: "不知道 MOQ 就报采购计划，供应商回一句「这个量不接」，交期从那一刻开始就已经晚了。",
    required: true,
    satisfiedBy: { keywords: ["moq", "起订量", "最小订货量", "最低订购量", "最小起订"] },
    askIfMissing: "知识库里没有 MOQ 资料 —— 让每家主力供应商给一份「常购物料 MOQ 与包装规格对照表」（Excel 即可），这是一次性能省掉后面几十次来回确认的东西。",
  },
  {
    id: "ordering.pack-round",
    category: "ordering",
    name: "包装规格与凑整",
    why: "按需求数下单、不按包装数凑整，供应商要么自己凑整多发、要么拆包加收费用，多出来的那部分对账时才被发现。",
    required: false,
    satisfiedBy: { keywords: ["包装规格", "包装数", "凑整", "整包", "箱入数", "spq", "最小包装"] },
    askIfMissing: "知识库里没有包装规格表 —— 跟 MOQ 一起向供应商要（一张表就够），并注明「不足整包怎么处理」是向上凑还是允许拆包。",
  },
  {
    id: "ordering.lead-time",
    category: "ordering",
    name: "提前期与最晚下单日",
    why: "不会倒推最晚下单日，就只能等计划催你才下单，每一单都是急单，长期下来价格也谈不动。",
    required: true,
    satisfiedBy: { keywords: ["提前期", "lead time", "交期倒推", "最晚下单日", "下单周期", "备货周期", "生产周期"] },
    askIfMissing: "知识库里没有提前期数据 —— 向每家供应商索取「标准交货周期表」（分常规料/定制料），再加上你们内部的到货检验和入库耗时，合成一张表导进来。",
  },
  {
    id: "ordering.requisition",
    category: "ordering",
    name: "请购单到采购订单",
    why: "跳过请购直接下单，属于越权采购，单据链断了财务不给付款，供应商的钱卡在中间最难收场。",
    required: true,
    satisfiedBy: { keywords: ["请购单", "请购", "申购", "请购流程", "转采购订单", "请购转"] },
    askIfMissing: "知识库里没有请购流程 —— 找主管或 ERP 管理员要一份《请购管理流程》，重点确认「谁能提请购、谁审批、审批完谁转订单」这三句话。",
  },

  // ---------- 供应商与商务 ----------
  {
    id: "supplier.quote-compare",
    category: "supplier",
    name: "询价比价的可比口径",
    why: "口径不统一的比价就是在比谁会写报价单，最后选出来的往往是最贵的那家。",
    required: true,
    satisfiedBy: { keywords: ["比价", "询价", "报价单", "比价表", "可比", "价格对比", "三家报价"] },
    askIfMissing: "知识库里没有比价的做法 —— 找主管要一份公司在用的比价表模板；没有模板就把最近一次比价的三份报价单和最后结论存成一份文档导进来，重点标注统一了哪些口径（含税/运费/包装/最小批量）。",
  },
  {
    id: "supplier.contract-terms",
    category: "supplier",
    name: "合同与商务条款",
    why: "条款没落纸，出了质量或延误纠纷时你手上一张牌都没有，只能靠人情谈。",
    required: false,
    satisfiedBy: { keywords: ["合同", "商务条款", "框架协议", "订单条款", "违约", "质保期", "签订"] },
    askIfMissing: "知识库里没有合同范本 —— 找法务或主管要一份公司标准采购合同/框架协议模板，并问清哪些条款可以改、哪些一个字都不能动。",
  },
  {
    id: "supplier.payment-terms",
    category: "supplier",
    name: "账期的起算点",
    why: "「月结 60 天」从对账日算还是从发票日算，差出来就是一个月，供应商停供时才发现是你答应错了。",
    required: true,
    satisfiedBy: { keywords: ["账期", "月结", "付款条款", "付款周期", "起算", "结算方式", "款到发货", "货到付款"] },
    askIfMissing: "知识库里没写清账期怎么算 —— 找财务确认一句话：账期从哪天开始数（到货日/对账日/开票日），把这句话和公司标准账期一起写进来，再对照合同核一遍。",
  },
  {
    id: "supplier.performance",
    category: "supplier",
    name: "供应商考核指标",
    why: "没有考核数据，换供应商这件事永远推不动，出了事也只能凭印象说「这家一直不行」。",
    required: false,
    satisfiedBy: { keywords: ["供应商考核", "准交率", "绩效", "考核表", "评分", "合格供应商", "年度评估"] },
    askIfMissing: "知识库里没有供应商考核办法 —— 找品质或主管要一份《供应商年度评估表》；没有的话，先把你自己记的准交率/来料不良记录整理成一份表导进来，那也是数据。",
  },

  // ---------- 到货与入库 ----------
  {
    id: "inbound.arrival-notice",
    category: "inbound",
    name: "到货预告怎么发",
    why: "不提前预告，货到了仓库没人没地方没检验计划，车堵在门口卸不下来，责任全落在采购身上。",
    required: true,
    satisfiedBy: { keywords: ["到货预告", "到货计划", "预告", "发货通知", "提前告知仓库", "到货安排"] },
    askIfMissing: "知识库里没有到货预告的做法 —— 问仓管一句「你希望我提前多久、用什么方式、告诉你哪几项信息」，把他的回答原样记下来导进来，这就是最准的一份 SOP。",
  },
  {
    id: "inbound.arrival-record",
    category: "inbound",
    name: "到货登记（货到了，还没进账）",
    why: "到货只代表货进了厂区，数量待点、质量待检；把到货当入库汇报，产线以为能领料，实际库里一个都没有。",
    required: true,
    satisfiedBy: { keywords: ["到货单", "到货登记", "收货", "签收", "送货单", "点数", "暂收"] },
    askIfMissing: "知识库里没有到货登记的步骤 —— 找仓管要一份到货单/收货单样例，问清「谁签字、签几联、哪一联回到采购手上」。",
  },
  {
    id: "inbound.receipt-posting",
    category: "inbound",
    name: "采购入库单与过账",
    why: "入库单一过账，库存和应付同时动；单开错了，钱和货两边一起错，冲销要惊动财务。",
    required: true,
    satisfiedBy: { keywords: ["采购入库单", "入库单", "入库", "过账", "记账", "入库数量", "红字入库"], minChunks: 2 },
    askIfMissing: "知识库里没有入库单的操作步骤 —— 让仓管带你看一遍他怎么做入库单并截图，重点问清「入库数量和到货数量不一致时以哪个为准」。",
  },
  {
    id: "inbound.acceptance",
    category: "inbound",
    name: "来料验收标准",
    why: "没有成文的验收标准，收与不收全靠现场吵；供应商下次照样这么发，问题永远不会收敛。",
    required: true,
    satisfiedBy: { keywords: ["验收", "来料检验", "iqc", "检验标准", "抽检", "报检", "合格判定", "aql"] },
    askIfMissing: "知识库里没有任何关于验收标准的内容 —— 去品质部要一份《来料检验规范》或 IQC 检验标准；他们说没有的话，退一步要抽检比例和判退规则，哪怕先要一页。",
  },
  {
    id: "inbound.short-over",
    category: "inbound",
    name: "欠交、超交与拒收的处理",
    why: "欠交不追、超交照收、该拒不拒，三种都会在月底对账时变成一笔说不清的差异。",
    required: true,
    satisfiedBy: { keywords: ["欠交", "超交", "拒收", "退货", "换货", "少发", "多发", "数量差异"] },
    askIfMissing: "知识库里没有欠交/超交/拒收的处理规则 —— 找主管确认三条底线：超交多少以内可以收、欠交多久必须升级、拒收由谁通知供应商，写成三句话导进来。",
  },

  // ---------- 对账与付款 ----------
  {
    id: "finance.tax-inclusive",
    category: "finance",
    name: "含税与不含税",
    why: "拿含税价跟未税价比，13% 的差直接把结论比反了；订单录错税种，发票来了对不上还得整单重开。",
    required: true,
    satisfiedBy: { keywords: ["含税", "未税", "不含税", "税率", "价税合计", "税额", "专票", "普票"] },
    askIfMissing: "知识库里没写清含税口径 —— 找财务确认两件事：报价一律按含税还是未税谈、常购物料适用什么税率，写成一段话导进来，再在比价表上写死这个口径。",
  },
  {
    id: "finance.reconciliation",
    category: "finance",
    name: "月度对账口径",
    why: "对账口径不一致，你按入库算、供应商按发货算，每个月都要花两天扯清楚，还常常漏单。",
    required: true,
    satisfiedBy: { keywords: ["对账", "对账单", "月结对账", "核对金额", "对账日", "结算清单"] },
    askIfMissing: "知识库里没有对账流程 —— 找财务要一份对账单模板和对账时间表（每月几号截止），并确认按入库日还是发货日归属当月。",
  },
  {
    id: "finance.invoice-payment",
    category: "finance",
    name: "发票与付款申请",
    why: "发票抬头、税号、品名规格有一项对不上就得退票重开，一退就是一个账期，供应商的火全烧到采购身上。",
    required: true,
    satisfiedBy: { keywords: ["发票", "开票", "付款申请", "请款", "抬头", "税号", "付款流程", "报销"] },
    askIfMissing: "知识库里没有开票与请款的规则 —— 找财务要「开票信息卡」（抬头/税号/地址电话/开户行）和付款申请单模板，这两样发给供应商能少掉一半退票。",
  },
  {
    id: "finance.accrual",
    category: "finance",
    name: "暂估与暂估回冲",
    why: "货到票未到要暂估，发票来了要回冲；不懂这一步，就会看到同一批货在系统里挂了两次账，误以为供应商多开了票。",
    required: false,
    satisfiedBy: { keywords: ["暂估", "回冲", "暂估入账", "货到票未到", "红字冲回", "暂估应付"] },
    askIfMissing: "知识库里没有暂估的说明 —— 找财务用一个真实例子讲一遍「这批货为什么在系统里显示两笔」，把这个例子记下来导进来，比看制度管用。",
  },

  // ---------- 跨部门协作 ----------
  {
    id: "collab.warehouse-handoff",
    category: "collab",
    name: "与仓库的交接清单",
    why: "交接漏一项（送货单联数、批号、外箱标签），货就卡在收货区进不了库，产线在等，两边互相等对方开口。",
    required: true,
    satisfiedBy: { keywords: ["仓管", "仓库对接", "交接", "收货区", "随货单据", "标签", "码单"] },
    askIfMissing: "知识库里没有和仓库的交接约定 —— 跟仓管当面过一遍「一批货进门需要哪些单据和标识」，逐条列出来（谁提供、几联、贴哪里），双方各留一份。",
  },
  {
    id: "collab.production-plan",
    category: "collab",
    name: "与生产计划的接口",
    why: "不知道计划什么时候出、按什么周期滚动，你的下单节奏就永远跟着救火走。",
    required: false,
    satisfiedBy: { keywords: ["生产计划", "计划部", "排产", "滚动计划", "计划变更", "月度计划", "周计划"] },
    askIfMissing: "知识库里没有生产计划的接口说明 —— 问计划员三件事：计划每周几发、发到哪里、变更了怎么通知你，把答案写成三行导进来。",
  },
  {
    id: "collab.quality-escalation",
    category: "collab",
    name: "来料异常的升级路径",
    why: "来料不良压着不报，等到上线才炸，损失从「退一批货」升级成「停一条线」。",
    required: false,
    satisfiedBy: { keywords: ["异常", "升级", "不良", "品质部", "8d", "纠正措施", "异常单", "特采"] },
    askIfMissing: "知识库里没有来料异常的升级路径 —— 找品质部确认「发现不良后多久内要开异常单、谁通知供应商、什么情况可以特采放行」，三句话即可。",
  },
  {
    id: "collab.chase-script",
    category: "collab",
    name: "催货与升级的话术",
    why: "只会「到了吗」这一句，供应商就永远回「快了」；催不出结果又不敢升级，交期就这么一天天拖没了。",
    required: false,
    satisfiedBy: { keywords: ["催货", "催料", "话术", "跟催", "逾期", "升级沟通", "怎么说"] },
    askIfMissing: "知识库里没有催货话术 —— 把你最近三次催出结果的对话原样记下来（要到了具体日期和责任人的那几次），整理成一份话术卡导进来。",
  },

  // ---------- 公司制度流程 ----------
  {
    id: "policy.approval-matrix",
    category: "policy",
    name: "审批权限矩阵",
    why: "不知道多少钱以上要谁批，要么越权下单被追责，要么什么都往上报，主管开始躲你。",
    required: true,
    satisfiedBy: { keywords: ["审批权限", "权限矩阵", "审批流程", "审批人", "金额权限", "分级审批", "授权"] },
    askIfMissing: "知识库里没有审批权限说明 —— 找主管或行政要一份《授权审批权限表》，重点确认采购金额分几档、每档谁批、谁能代批。",
  },
  {
    id: "policy.integrity",
    category: "policy",
    name: "廉洁红线",
    why: "这条不是「注意一下」，是踩了就走人的线；而且不写清楚，供应商的试探你会分不清是人情还是陷阱。",
    required: true,
    satisfiedBy: { keywords: ["廉洁", "红线", "回扣", "利益冲突", "禁止收受", "职业操守", "反舞弊", "亲属关系"] },
    askIfMissing: "知识库里没有廉洁规定 —— 找 HR 要《员工行为准则》里采购相关的那几条，或你入职时签过的廉洁承诺书，扫描一份导进来。",
  },
  {
    id: "policy.supplier-onboarding",
    category: "policy",
    name: "供应商准入",
    why: "跳过准入直接下单，供应商在系统里建不了档、财务打不了款，最后是你去求人补流程。",
    required: false,
    satisfiedBy: { keywords: ["供应商准入", "准入", "新供应商", "开发供应商", "资质", "营业执照", "供应商建档", "考察"] },
    askIfMissing: "知识库里没有供应商准入流程 —— 要一份新供应商资料清单（营业执照/资质/开户信息/样品要求）和审批路径，第一次开发新供应商前一定要有。",
  },
  {
    id: "policy.record-keeping",
    category: "policy",
    name: "留痕与归档",
    why: "口头答应的降价、微信里改的交期，事后一律不算数；出事时能救你的只有存下来的那份记录。",
    required: false,
    satisfiedBy: { keywords: ["留痕", "归档", "存档", "书面确认", "邮件确认", "记录保存", "备案", "保存年限"] },
    askIfMissing: "知识库里没有留痕要求 —— 问一句「哪些事必须走邮件、单据要留几年」，把答案和公司的归档规定一起导进来；没有成文规定就自己定一条：凡涉及价格和交期的口头结论，当天补一封邮件。",
  },

  // ---------- 物料与技术 ----------
  {
    id: "material.code-rule",
    category: "material",
    name: "物料编码规则",
    why: "认不出编码就只能靠品名下单，长得像的两个料号下错一个，整批货报废。",
    required: true,
    satisfiedBy: { keywords: ["物料编码", "存货编码", "编码规则", "料号", "编码含义", "存货档案"] },
    askIfMissing: "知识库里没有编码规则 —— 找 ERP 管理员或技术部要一份《物料编码规则》，把编码每一段代表什么整理成一张对照表；顺手要一份常购物料的编码清单。",
  },
  {
    id: "material.spec-sheet",
    category: "material",
    name: "规格书与图纸版本",
    why: "按旧版图纸下单，供应商照做也做错，钱和时间双输，而且这种错很难在来料时看出来。",
    required: false,
    satisfiedBy: { keywords: ["规格书", "图纸", "版本", "承认书", "技术参数", "材质", "物性表", "版次"] },
    askIfMissing: "知识库里没有规格书 —— 找技术部要常购物料的规格书/图纸最新版，并确认「版本变更了谁通知采购」这个机制，光有文件不够。",
  },
  {
    id: "material.substitute",
    category: "material",
    name: "替代料与 ECN 变更",
    why: "私自换替代料是重大质量事故的常见起点；反过来，工程发了 ECN 你没跟上，旧料就成了呆料。",
    required: false,
    satisfiedBy: { keywords: ["替代料", "ecn", "工程变更", "代用", "变更通知", "切换", "呆料"] },
    askIfMissing: "知识库里没有替代料/变更的规则 —— 找技术部确认「替代料谁有权批准、ECN 发出后旧料怎么处理」，并要求把采购加进 ECN 的通知名单。",
  },
  {
    id: "material.uom",
    category: "material",
    name: "计量单位与换算",
    why: "采购单位是「卷」、库存单位是「米」，换算错一位就是十倍的量，订单一审就过了，等货到才发现。",
    required: true,
    satisfiedBy: { keywords: ["计量单位", "单位换算", "换算率", "采购单位", "库存单位", "主计量", "辅计量"] },
    askIfMissing: "知识库里没有单位换算表 —— 找 ERP 管理员导出存货档案里的主/辅计量单位和换算率，存成一张表；重点标出采购单位和库存单位不一致的那些料。",
  },

  // ---------- 其他 ----------
  {
    id: "other.glossary",
    category: "other",
    name: "公司内部术语与缩写表",
    why: "听不懂会上的黑话，就只能会后一个个问；问多了不好意思，就开始装懂，然后开始出错。",
    required: false,
    satisfiedBy: { keywords: ["术语", "缩写", "名词解释", "黑话", "简称", "词汇表"] },
    askIfMissing: "知识库里没有术语表 —— 从今天起把每天听到不懂的词记一行（词 + 谁说的 + 什么意思），两周后就是一份别人也想要的表，导进来。",
  },
  {
    id: "other.contacts",
    category: "other",
    name: "关键联系人与对接清单",
    why: "急事找不到对的人，就只能在群里喊；喊一次没人应，事情就拖过了当天。",
    required: false,
    satisfiedBy: { keywords: ["联系人", "对接人", "通讯录", "接口人", "找谁", "分机", "责任人"] },
    askIfMissing: "知识库里没有联系人清单 —— 自己列一张：仓库、品质、计划、财务、ERP 管理员各是谁、电话/企微、以及「什么事找他」，一张表五分钟。",
  },
];

/** 单向声明一次，双向由 TOPICS 推出。contrast 尽量写足——易混对照是新人最容易踩的坑。 */
export const RELATIONS: TopicRelation[] = [
  // 前置：不懂前者就看不懂后者
  { from: "u8.login-account", to: "u8.stock-query", kind: "prerequisite" },
  { from: "u8.login-account", to: "u8.po-entry", kind: "prerequisite" },
  { from: "u8.stock-query", to: "ordering.net-shortage", kind: "prerequisite" },
  { from: "ordering.available-qty", to: "ordering.net-shortage", kind: "prerequisite" },
  { from: "collab.production-plan", to: "ordering.net-shortage", kind: "prerequisite" },
  { from: "ordering.net-shortage", to: "ordering.moq", kind: "prerequisite" },
  { from: "ordering.net-shortage", to: "ordering.pack-round", kind: "prerequisite" },
  { from: "ordering.lead-time", to: "ordering.requisition", kind: "prerequisite" },
  { from: "policy.approval-matrix", to: "ordering.requisition", kind: "prerequisite" },
  { from: "material.code-rule", to: "u8.po-entry", kind: "prerequisite" },
  { from: "inbound.acceptance", to: "inbound.receipt-posting", kind: "prerequisite" },
  { from: "material.spec-sheet", to: "inbound.acceptance", kind: "prerequisite" },
  { from: "finance.tax-inclusive", to: "supplier.quote-compare", kind: "prerequisite" },
  { from: "basics.5r", to: "supplier.quote-compare", kind: "prerequisite" },
  { from: "basics.three-way-match", to: "finance.invoice-payment", kind: "prerequisite" },
  { from: "supplier.payment-terms", to: "finance.invoice-payment", kind: "prerequisite" },
  { from: "policy.supplier-onboarding", to: "supplier.contract-terms", kind: "prerequisite" },

  // 易混对照：长得像、不是一回事，错一次就是一次事故
  { from: "u8.stock-query", to: "ordering.available-qty", kind: "contrast" },
  { from: "inbound.arrival-record", to: "inbound.receipt-posting", kind: "contrast" },
  { from: "inbound.arrival-notice", to: "inbound.arrival-record", kind: "contrast" },
  { from: "ordering.moq", to: "ordering.pack-round", kind: "contrast" },
  { from: "ordering.requisition", to: "u8.po-entry", kind: "contrast" },
  { from: "u8.po-entry", to: "u8.reference-generate", kind: "contrast" },
  { from: "finance.accrual", to: "finance.invoice-payment", kind: "contrast" },
  { from: "supplier.payment-terms", to: "finance.reconciliation", kind: "contrast" },
  { from: "basics.three-way-match", to: "finance.reconciliation", kind: "contrast" },
  { from: "material.code-rule", to: "material.spec-sheet", kind: "contrast" },
  { from: "material.uom", to: "ordering.pack-round", kind: "contrast" },
  { from: "basics.role-boundary", to: "collab.production-plan", kind: "contrast" },
  { from: "inbound.acceptance", to: "inbound.short-over", kind: "contrast" },
  { from: "collab.quality-escalation", to: "collab.chase-script", kind: "contrast" },

  // 下游影响：前者出问题，后者跟着遭殃
  { from: "u8.po-entry", to: "inbound.arrival-notice", kind: "downstream" },
  { from: "ordering.lead-time", to: "collab.production-plan", kind: "downstream" },
  { from: "inbound.arrival-notice", to: "collab.warehouse-handoff", kind: "downstream" },
  { from: "inbound.receipt-posting", to: "finance.accrual", kind: "downstream" },
  { from: "inbound.receipt-posting", to: "finance.reconciliation", kind: "downstream" },
  { from: "inbound.short-over", to: "collab.production-plan", kind: "downstream" },
  { from: "inbound.acceptance", to: "collab.quality-escalation", kind: "downstream" },
  { from: "finance.reconciliation", to: "finance.invoice-payment", kind: "downstream" },
  { from: "supplier.quote-compare", to: "supplier.contract-terms", kind: "downstream" },
  { from: "supplier.performance", to: "policy.supplier-onboarding", kind: "downstream" },
  { from: "collab.chase-script", to: "supplier.performance", kind: "downstream" },
  { from: "u8.reference-generate", to: "inbound.receipt-posting", kind: "downstream" },
  { from: "material.substitute", to: "u8.po-entry", kind: "downstream" },

  // 同一份文件：找一份就能一起补齐
  { from: "policy.approval-matrix", to: "policy.integrity", kind: "same-doc" },
  { from: "policy.integrity", to: "policy.supplier-onboarding", kind: "same-doc" },
  { from: "policy.record-keeping", to: "policy.approval-matrix", kind: "same-doc" },
  { from: "policy.record-keeping", to: "finance.invoice-payment", kind: "same-doc" },
  { from: "supplier.contract-terms", to: "supplier.payment-terms", kind: "same-doc" },
  { from: "supplier.performance", to: "supplier.contract-terms", kind: "same-doc" },
  { from: "collab.warehouse-handoff", to: "inbound.receipt-posting", kind: "same-doc" },
  { from: "material.substitute", to: "material.spec-sheet", kind: "same-doc" },
  { from: "material.uom", to: "material.code-rule", kind: "same-doc" },
  { from: "finance.tax-inclusive", to: "finance.reconciliation", kind: "same-doc" },
  { from: "other.glossary", to: "basics.5r", kind: "same-doc" },
  { from: "other.glossary", to: "basics.three-way-match", kind: "same-doc" },
  { from: "other.contacts", to: "collab.warehouse-handoff", kind: "same-doc" },
  { from: "other.contacts", to: "collab.production-plan", kind: "same-doc" },
  { from: "other.contacts", to: "basics.role-boundary", kind: "same-doc" },
];

/** 建表时顺手校验：id 重复 / 自环 / 指向不存在的主题 / 同一对重复声明，都在模块加载时炸出来 */
function buildTopics(): TopicSpec[] {
  const byId = new Map<string, TopicSpec>();
  for (const s of SEEDS) {
    if (byId.has(s.id)) throw new Error(`taxonomy: 主题 id 重复「${s.id}」`);
    byId.set(s.id, { ...s, relatedTo: [], relationKind: {} });
  }
  const seen = new Set<string>();
  for (const { from, to, kind } of RELATIONS) {
    if (from === to) throw new Error(`taxonomy: 自环关联「${from}」`);
    const a = byId.get(from);
    const b = byId.get(to);
    if (!a) throw new Error(`taxonomy: 关联指向不存在的主题「${from}」`);
    if (!b) throw new Error(`taxonomy: 关联指向不存在的主题「${to}」`);
    const key = [from, to].sort().join("|");
    if (seen.has(key)) throw new Error(`taxonomy: 同一对主题重复声明关联「${key}」`);
    seen.add(key);
    a.relatedTo.push(to);
    a.relationKind[to] = kind;
    b.relatedTo.push(from);
    b.relationKind[from] = INVERSE[kind];
  }
  return [...byId.values()];
}

export const TOPICS: TopicSpec[] = buildTopics();

const TOPIC_BY_ID = new Map(TOPICS.map((t) => [t.id, t]));
export const topicById = (id: string): TopicSpec | undefined => TOPIC_BY_ID.get(id);

/** 必备主题数——面板顶部那条「必备主题覆盖 x/N」的分母 */
export const REQUIRED_COUNT: number = TOPICS.filter((t) => t.required).length;

/** 按 classify 的 10 类分组，顺序跟 CATEGORIES 一致由调用方保证 */
export function topicsByCategory(category: string): TopicSpec[] {
  return TOPICS.filter((t) => t.category === category);
}

/** 某条主题的关联，按类型分组；contrast 排最前——那是最该先看的 */
export function relationsOf(topicId: string): { topic: TopicSpec; kind: RelationKind }[] {
  const t = TOPIC_BY_ID.get(topicId);
  if (!t) return [];
  const order: RelationKind[] = ["contrast", "prerequisite", "downstream", "same-doc"];
  return t.relatedTo
    .map((id) => ({ topic: TOPIC_BY_ID.get(id)!, kind: t.relationKind[id] }))
    .filter((r) => !!r.topic)
    .sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
}
