// 采购学习的权威信源库。
//
// 规矩（和 content.ts 的可信度口径一脉相承，只是这里核的不是菜单路径，是出版信息）：
//   confidence: "verified"   —— 书名 / 作者 / 出版社 / 年份 / ISBN（或标准号、官方课程页）逐项查到了确切出处
//   confidence: "unverified" —— 这本书 / 这门课确实存在，但出版信息只有电商或二手来源，没核到权威页
// 红线：查不到就标 unverified，绝不编 ISBN、作者、出版社或链接。宁可少几条。
//
// covers 里的分类必须用知识库那 10 类（src/knowledge/classify.ts 的 CategoryId），
// 这样以后把某本书的读书笔记喂进知识库时，分类是对得上的。

/** 与 src/knowledge/classify.ts 的 CategoryId 保持一致，这里单独写一份，避免跨模块耦合。 */
export const SOURCE_COVER_IDS = [
  "basics",
  "u8",
  "ordering",
  "supplier",
  "inbound",
  "finance",
  "collab",
  "policy",
  "material",
  "other",
] as const;
export type SourceCover = (typeof SOURCE_COVER_IDS)[number];

export type SourceKind = "book" | "standard" | "course" | "video" | "site";

export interface Source {
  id: string;
  kind: SourceKind;
  title: string;
  author?: string;
  publisher?: string;
  year?: number;
  isbn?: string;
  lang: "zh" | "en";
  /** 对一个制造业采购新人具体有什么用，一句话，别写书评。 */
  why: string;
  /** 覆盖哪些主题，取值必须在 SOURCE_COVER_IDS 里。 */
  covers: SourceCover[];
  level: "入门" | "进阶" | "参考";
  /** 官方或可靠出处。没有可靠链接就不填，不编。 */
  url?: string;
  confidence: "verified" | "unverified";
}

export const SOURCE_KIND_LABELS: Record<SourceKind, string> = {
  book: "书籍",
  standard: "标准与法规",
  course: "认证与系统课程",
  video: "公开课 / 视频",
  site: "官方站点与资料库",
};

/** 展示顺序：先看书，再看该守的规矩，再考证书/上课，最后是查资料的地方。 */
export const SOURCE_KIND_ORDER: SourceKind[] = ["book", "standard", "course", "video", "site"];

export const SOURCES: Source[] = [
  // ---------------- 书籍 · 中文 ----------------
  {
    id: "liu-procurement-scm-3e",
    kind: "book",
    title: "采购与供应链管理：一个实践者的角度（第 3 版）",
    author: "刘宝红",
    publisher: "机械工业出版社",
    year: 2019,
    isbn: "9787111618775",
    lang: "zh",
    why: "中文里最贴近一线的采购读物，讲的是「为什么供应商总不准时」「为什么砍价砍不动」这类你每天都碰到的事，不是理论课本。",
    covers: ["basics", "supplier", "ordering", "collab"],
    level: "入门",
    url: "https://book.douban.com/subject/30649813/",
    confidence: "verified",
  },
  {
    id: "liu-three-defense-lines",
    kind: "book",
    title: "供应链的三道防线：需求预测、库存计划、供应链执行",
    author: "刘宝红、赵玲",
    publisher: "机械工业出版社",
    year: 2018,
    isbn: "9787111595144",
    lang: "zh",
    why: "专治「到底该下多少」——把需求预测、安全库存、执行催货分成三道防线，正好对应你算净缺口和定安全水位那两步。",
    covers: ["ordering", "material", "basics"],
    level: "进阶",
    url: "https://book.douban.com/subject/30223850/",
    confidence: "verified",
  },
  {
    id: "ma-shihua-scm-6e",
    kind: "book",
    title: "供应链管理（第 6 版）",
    author: "马士华、林勇 等",
    publisher: "机械工业出版社",
    year: 2020,
    isbn: "9787111657491",
    lang: "zh",
    why: "国内高校通用教材，术语和概念体系最标准；跟别人对话时「牛鞭效应」「提前期」「安全库存」这些词该怎么用，以它为准。",
    covers: ["basics", "ordering", "inbound"],
    level: "入门",
    url: "http://www.cmpedu.com/books/book/5602185.htm",
    confidence: "verified",
  },
  {
    id: "gong-negotiation-scenarios",
    kind: "book",
    title: "全情景采购谈判技巧",
    author: "宫迅伟、罗宏勇、汪浩",
    publisher: "机械工业出版社",
    year: 2020,
    isbn: "9787111656210",
    lang: "zh",
    why: "催货、压价、要赔偿都是谈判；这本按场景给话术和让步节奏，比笼统讲「谈判心理学」的书更能直接抄作业。",
    covers: ["supplier", "collab"],
    level: "进阶",
    url: "https://book.douban.com/subject/35118543/",
    confidence: "verified",
  },
  {
    id: "liu-light-asset-scm",
    kind: "book",
    title: "供应链管理：重资产到轻资产的解决方案",
    author: "刘宝红",
    publisher: "机械工业出版社",
    year: 2021,
    isbn: "9787111681120",
    lang: "zh",
    why: "想明白公司为什么外包、为什么盯着库存周转率不放；看懂了老板的账，你提的降本方案才有人听。",
    covers: ["basics", "finance", "policy"],
    level: "参考",
    url: "https://book.douban.com/subject/35513199/",
    confidence: "verified",
  },
  {
    id: "gong-the-way-of-procurement",
    kind: "book",
    title: "采购之道",
    author: "宫迅伟",
    publisher: "机械工业出版社",
    lang: "zh",
    why: "国内采购培训体系里流传很广的一本职业观读物，适合想清楚「采购这个岗位往上怎么走」。",
    covers: ["basics", "policy"],
    level: "参考",
    confidence: "unverified", // 只在电商页见到条目，未核到出版社官网/豆瓣的确切出版年与 ISBN，故不写 isbn/year
  },

  // ---------------- 书籍 · 英文 ----------------
  {
    id: "monczka-pscm-7e",
    kind: "book",
    title: "Purchasing and Supply Chain Management (7th Edition)",
    author: "Robert M. Monczka, Robert B. Handfield, Larry C. Giunipero, James L. Patterson",
    publisher: "Cengage Learning",
    year: 2020,
    isbn: "9780357442142",
    lang: "en",
    why: "欧美采购专业最主流的教科书，寻源、合同、供应商绩效这套完整方法论的底本；国内很多培训课的框架都是从它来的。",
    covers: ["basics", "supplier", "policy", "finance"],
    level: "参考",
    url: "https://www.cengage.com/c/purchasing-and-supply-chain-management-7e-monczka-handfield-giunipero-patterson/9780357442142/",
    confidence: "verified",
  },
  {
    id: "chopra-scm-7e",
    kind: "book",
    title: "Supply Chain Management: Strategy, Planning, and Operation (7th Edition)",
    author: "Sunil Chopra, Peter Meindl",
    publisher: "Pearson",
    year: 2019,
    isbn: "9780134731889",
    lang: "en",
    why: "安全库存、订货批量、提前期不确定性这些公式的标准出处；你算净缺口时用的那些直觉，这本给出了算式。",
    covers: ["ordering", "basics", "material"],
    level: "参考",
    url: "https://www.pearson.com/en-us/pearsonplus/p/9780137502844",
    confidence: "verified",
  },
  {
    id: "hopp-factory-physics-3e",
    kind: "book",
    title: "Factory Physics (Third Edition)",
    author: "Wallace J. Hopp, Mark L. Spearman",
    publisher: "Waveland Press",
    year: 2011,
    isbn: "9781577667391",
    lang: "en",
    why: "解释「为什么提前期一波动、库存就得加一大截」的物理规律；理解了它，你就不会再被「多备点总没错」这种话说服。",
    covers: ["ordering", "material", "basics"],
    level: "参考",
    url: "https://www.waveland.com/browse.php?t=587",
    confidence: "verified",
  },
  {
    id: "kraljic-1983-hbr",
    kind: "book",
    title: "Purchasing Must Become Supply Management（Kraljic 采购矩阵原文）",
    author: "Peter Kraljic",
    publisher: "Harvard Business Review 61(5), pp.109–117",
    year: 1983,
    lang: "en",
    why: "把物料按「金额高低 × 供应风险」分四类的经典方法；决定哪些料值得你花时间谈、哪些料照着流程走就行，用的就是这张图。",
    covers: ["supplier", "policy", "material"],
    level: "参考",
    url: "https://hbr.org/1983/09/purchasing-must-become-supply-management",
    confidence: "verified",
  },
  {
    id: "lee-bullwhip-1997",
    kind: "book",
    title: "The Bullwhip Effect in Supply Chains（牛鞭效应原文）",
    author: "Hau L. Lee, V. Padmanabhan, Seungjin Whang",
    publisher: "Sloan Management Review 38(3)",
    year: 1997,
    lang: "en",
    why: "解释为什么生产表小小一动、你的订单就要大改一版；看完你会更愿意去跟计划要真实需求，而不是照着放大后的数字下单。",
    covers: ["ordering", "collab", "basics"],
    level: "参考",
    url: "https://sloanreview.mit.edu/article/the-bullwhip-effect-in-supply-chains/",
    confidence: "verified",
  },

  // ---------------- 标准与法规 ----------------
  {
    id: "gbt-33456-2016",
    kind: "standard",
    title: "GB/T 33456—2016《工业企业供应商管理评价准则》",
    publisher: "国家标准（TC151 归口），2016-12-30 发布，2017-07-01 实施",
    year: 2016,
    lang: "zh",
    why: "国家标准层面的供应商准入、评价、退出该怎么做；公司要建供应商考核表时，照它列条目比自己拍脑袋靠谱。",
    covers: ["supplier", "policy"],
    level: "参考",
    url: "https://openstd.samr.gov.cn/bzgk/std/newGbInfo?hcno=729B81B99ACA632575B1583BBCA745A9",
    confidence: "verified",
  },
  {
    id: "gbt-19001-2016-8-4",
    kind: "standard",
    title: "GB/T 19001—2016 / ISO 9001:2015 第 8.4 条「外部提供的过程、产品和服务的控制」",
    publisher: "国家标准（等同采用 ISO 9001:2015）",
    year: 2016,
    lang: "zh",
    why: "体系审核时问你「你怎么控制供应商」，标准答案就在这一条；也是「为什么每次都要留书面记录」的制度依据。",
    covers: ["policy", "supplier", "inbound"],
    level: "参考",
    confidence: "verified",
  },
  {
    id: "civil-code-inspection",
    kind: "standard",
    title: "《中华人民共和国民法典》合同编 · 买卖合同 第 620–621 条（检验义务与数量质量异议期限）",
    publisher: "全国人民代表大会",
    year: 2020,
    lang: "zh",
    why: "到货后不及时提异议，法律上可能视为「数量质量符合约定」——这就是为什么差异必须当天拍照、当天书面通知供应商。",
    covers: ["inbound", "policy", "supplier"],
    level: "参考",
    confidence: "verified",
  },

  // ---------------- 认证与系统课程 ----------------
  {
    id: "cips-qualifications",
    kind: "course",
    title: "CIPS 采购与供应资格体系（Level 2 证书 → Level 6 专业文凭 → MCIPS）",
    publisher: "Chartered Institute of Procurement & Supply（英国皇家采购与供应学会）",
    lang: "en",
    why: "国际上认可度最高的采购资格阶梯，官网把每一级该会什么列得很细；即使不考，也能拿它当自己的能力清单对照表。",
    covers: ["basics", "supplier", "policy", "finance"],
    level: "参考",
    url: "https://www.cips.org/qualifications",
    confidence: "verified",
  },
  {
    id: "ism-cpsm",
    kind: "course",
    title: "CPSM · Certified Professional in Supply Management",
    publisher: "Institute for Supply Management (ISM)",
    lang: "en",
    why: "美国 ISM 的采购职业认证，报考要 3~5 年从业经验；把它当中期目标，能倒推出你这两年该补哪几块。",
    covers: ["basics", "supplier", "finance", "policy"],
    level: "参考",
    url: "https://www.ismworld.org/certification-and-training/certification/cpsm/",
    confidence: "verified",
  },
  {
    id: "ascm-apics-cpim",
    kind: "course",
    title: "APICS CPIM · Certified in Planning and Inventory Management",
    publisher: "ASCM（Association for Supply Chain Management）",
    lang: "en",
    why: "偏计划与库存那一半：MRP、主生产计划、安全库存、提前期，正是采购和计划吵架时用得上的共同语言。",
    covers: ["ordering", "material", "basics"],
    level: "进阶",
    url: "https://www.ascm.org/learning-development/certifications-credentials/cpim/",
    confidence: "verified",
  },
  {
    id: "coursera-scm-rutgers",
    kind: "course",
    title: "Supply Chain Management Specialization（物流 / 运营 / 计划 / 寻源 + 结课项目，共 5 门）",
    publisher: "Rutgers the State University of New Jersey · Coursera",
    lang: "en",
    why: "零基础也能跟的系统入门，其中 Supply Chain Sourcing 那门就是讲供应商关系怎么建，跟你的日常最贴。",
    covers: ["basics", "ordering", "supplier"],
    level: "入门",
    url: "https://www.coursera.org/specializations/supply-chain-management",
    confidence: "verified",
  },

  // ---------------- 公开课 / 视频 ----------------
  {
    id: "icourse163-whut-scm",
    kind: "video",
    title: "《供应链管理》（国家级一流课程）",
    publisher: "武汉理工大学 · 中国大学 MOOC",
    lang: "zh",
    why: "中文视频课里体系最全的一门，覆盖网络规划、战略采购与供应商管理、库存控制；通勤时间就能刷完一章。",
    covers: ["basics", "ordering", "supplier"],
    level: "入门",
    url: "https://www.icourse163.org/course/WHUT-1207166806",
    confidence: "verified",
  },
  {
    id: "icourse163-purchasing",
    kind: "video",
    title: "《采购管理》",
    publisher: "中国大学 MOOC",
    lang: "zh",
    why: "专讲采购本身：采购方式选择、需求分析、成本分析、供应商决策、订单分配、谈判与合同管理，比泛泛的供应链课更对口。",
    covers: ["basics", "supplier", "ordering"],
    level: "入门",
    url: "https://www.icourse163.org/course/detail.htm?cid=1450436168",
    confidence: "unverified", // 课程页确实存在，但未核到开课学校与主讲教师，开课状态也可能随学期变化
  },

  // ---------------- 官方站点与资料库 ----------------
  {
    id: "yonyou-u8-open-doc",
    kind: "site",
    title: "用友 U8 开放平台 · 文档中心",
    publisher: "用友网络科技股份有限公司",
    lang: "zh",
    why: "查 U8 单据字段的官方口径（比如采购订单到底有哪些字段、值域是什么），比论坛帖子可靠。",
    covers: ["u8"],
    level: "参考",
    url: "https://open.yonyouup.com/documentCenter/platformIntro",
    confidence: "verified",
  },
  {
    id: "yonyou-community-forum",
    kind: "site",
    title: "用友之家 · U8+ 版块（第三方论坛）",
    publisher: "用友之家",
    lang: "zh",
    why: "菜单路径、报错信息、补丁号这类实战问题，论坛帖往往比官方文档全；但它不是官方口径，看到的做法一律实机验证后再用。",
    covers: ["u8"],
    level: "参考",
    url: "https://www.oyonyou.com/",
    confidence: "unverified", // 第三方社区，内容未经官方审核，仅作线索来源
  },
];
