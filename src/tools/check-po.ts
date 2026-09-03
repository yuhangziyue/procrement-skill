// PO 十要素自查（order-checklist §D 的程序化版本）。
// 十要素：编码/名称规格、数量+单位、单价+税率(+含税口径)、到货日期（精确到日）、到货地点、收货时间窗、包装凑整说明、分批计划、质量/单证要求、违约条款。
// 前五项必填，缺一项 canIssue=false 并告诉你怎么补；后五项缺了只警告。不碰 IO / DOM / db。
import { normalizeDate } from "./track-status";

export interface PoInput {
  /** 存货编码 */
  code?: string;
  /** 存货名称 */
  name?: string;
  /** 规格（尺寸/材质/版本） */
  spec?: string;
  qty?: number;
  /** 单位：只/个/箱/扎… */
  unit?: string;
  price?: number;
  /** 税率：0.13 或 13 都认 */
  taxRate?: number;
  /** 含税口径：true=含税价 false=不含税价；undefined=没说清 */
  taxIncluded?: boolean;
  /** 到货日期，必须精确到日（YYYY-MM-DD / 2026/9/10 都认；「9月中旬」「下周」不认） */
  deliveryDate?: string;
  /** 到货地点（哪个仓） */
  deliveryPlace?: string;
  /** 收货时间窗，如「工作日 8:30-16:30」 */
  receivingWindow?: string;
  /** 包装凑整说明，如「500只/扎，按扎凑整」 */
  packNote?: string;
  /** 分批计划，如「首批 50% 9/10 到，余量 9/15 到」 */
  batchPlan?: string;
  /** 质量/单证要求，如「合格证 + 检测报告随货」 */
  qualityDocs?: string;
  /** 违约条款 */
  penalty?: string;
  /** 备注：加单来源 / 原订单号 / 加急约定 / 到货须工作日白天 */
  remark?: string;
}

export type PoField = "item" | "quantity" | "price" | "deliveryDate" | "deliveryPlace" | "receivingWindow" | "packNote" | "batchPlan" | "qualityDocs" | "penalty" | "remark";

export interface PoCheckItem {
  field: PoField;
  label: string;
  required: boolean;
  ok: boolean;
  /** 当前填了什么（展示用） */
  value: string;
  /** 不 ok 时：缺了什么 / 怎么补 */
  hint?: string;
}

export interface PoCheckResult {
  canIssue: boolean;
  items: PoCheckItem[];
  /** 必填缺项的 label */
  missingRequired: string[];
  /** 可选项缺失的警告 */
  warnings: string[];
  /** 每条缺项怎么补（必填在前） */
  fixes: string[];
  headline: string;
  /** 十要素逐项 markdown 表 */
  markdown: string;
}

const has = (s?: string) => typeof s === "string" && s.trim() !== "";
const isNum = (n?: number) => typeof n === "number" && Number.isFinite(n);

export function checkPo(po: PoInput): PoCheckResult {
  const items: PoCheckItem[] = [];

  // 1. 编码 / 名称规格（必填：编码或名称至少一个；规格缺了提醒）
  {
    const okItem = has(po.code) || has(po.name);
    const value = [po.code, po.name, po.spec].filter(has).join(" / ");
    let hint: string | undefined;
    if (!okItem) hint = "缺存货编码和名称：从生产表/物料表抄存货编码，编码对不上先和生产核对，不猜";
    else if (!has(po.code)) hint = "只有名称没有编码：U8 录单要编码，名称同名不同版会录错，补上存货编码";
    else if (!has(po.spec)) hint = "规格没写：尺寸/材质/版本写进名称或备注，改版品尤其要写清是新版还是旧版";
    items.push({ field: "item", label: "编码/名称规格", required: true, ok: okItem, value, hint });
  }
  // 2. 数量 + 单位
  {
    const qtyOk = isNum(po.qty) && (po.qty as number) > 0;
    const unitOk = has(po.unit);
    const value = [qtyOk ? String(po.qty) : "", po.unit ?? ""].filter(Boolean).join(" ");
    let hint: string | undefined;
    if (!qtyOk && !unitOk) hint = "数量和单位都没填：数量 = calc_order_qty 算出的凑整后净缺口，单位按供应商报价单口径（只/箱/扎）";
    else if (!qtyOk) hint = "数量缺失或 ≤ 0：填凑整后的净缺口，不是生产表原始需求";
    else if (!unitOk) hint = "有数量没单位：「5000」是只还是箱差 500 倍，写清单位";
    items.push({ field: "quantity", label: "数量+单位", required: true, ok: qtyOk && unitOk, value, hint });
  }
  // 3. 单价 + 税率 + 含税口径
  {
    const priceOk = isNum(po.price) && (po.price as number) >= 0;
    const taxOk = isNum(po.taxRate) && (po.taxRate as number) >= 0;
    const inclOk = typeof po.taxIncluded === "boolean";
    const taxText = taxOk ? `${(po.taxRate as number) <= 1 ? Math.round((po.taxRate as number) * 100) : po.taxRate}%` : "";
    const value = [priceOk ? `单价 ${po.price}` : "", taxText ? `税率 ${taxText}` : "", inclOk ? (po.taxIncluded ? "含税" : "不含税") : ""].filter(Boolean).join("，");
    const missing = [!priceOk && "单价", !taxOk && "税率", !inclOk && "含税口径"].filter(Boolean) as string[];
    const hint = missing.length
      ? `缺 ${missing.join("、")}：单价对照价格档案/最近报价（过有效期先重新确认），税率与供应商开票主体一致，明确写「含税」或「不含税」——口径不清 13% 的差额到对账时才炸`
      : undefined;
    items.push({ field: "price", label: "单价+税率+含税口径", required: true, ok: missing.length === 0, value, hint });
  }
  // 4. 到货日期（精确到日）
  {
    const norm = normalizeDate(po.deliveryDate);
    const ok = !!norm;
    let hint: string | undefined;
    if (!has(po.deliveryDate)) hint = "到货日期没填：填供应商回签的真实承诺日，不是生产需求日；这是入库和跟踪的锚点";
    else if (!ok) hint = `「${po.deliveryDate}」不是精确到日的日期：「9月中旬」「下周」不能进 PO，用 backward_schedule 倒推后写成 YYYY-MM-DD`;
    items.push({ field: "deliveryDate", label: "到货日期（精确到日）", required: true, ok, value: norm ?? (po.deliveryDate ?? ""), hint });
  }
  // 5. 到货地点
  items.push({
    field: "deliveryPlace", label: "到货地点", required: true, ok: has(po.deliveryPlace), value: po.deliveryPlace ?? "",
    hint: has(po.deliveryPlace) ? undefined : "到货地点没写：多仓公司送错仓 = 再调拨一次；写清仓库名 + 地址",
  });
  // 6~10 可选项：缺了只警告
  const optional: { field: PoField; label: string; value?: string; hint: string }[] = [
    { field: "receivingWindow", label: "收货时间窗", value: po.receivingWindow, hint: "没写收货时间窗：按档案「可送货时间窗」写，如「工作日 8:30-16:30」，避免货到没人收" },
    { field: "packNote", label: "包装凑整说明", value: po.packNote, hint: "没写凑整说明：不写清供应商会替你凑，到货和订单对不上；写「N 只/扎，按扎凑整」" },
    { field: "batchPlan", label: "分批计划", value: po.batchPlan, hint: "没写分批计划：大单会分批的写首批比例和各批到货日，每批单独进跟单表；一次到齐的写「一次到货」" },
    { field: "qualityDocs", label: "质量/单证要求", value: po.qualityDocs, hint: "没写单证要求：写「送货单 + 出厂合格证（+检测报告）随货」，缺证仓库可拒收" },
    { field: "penalty", label: "违约条款", value: po.penalty, hint: "没写违约条款：至少引用框架合同的延期/不良处理约定，事前有约定事后不扯皮" },
    { field: "remark", label: "备注（加单来源/原单号/加急/到货须工作日白天）", value: po.remark, hint: "备注为空：加单要写来源和原订单号；常规单至少写「到货须为工作日白天并提前一天预告」" },
  ];
  for (const o of optional) items.push({ field: o.field, label: o.label, required: false, ok: has(o.value), value: o.value ?? "", hint: has(o.value) ? undefined : o.hint });

  const missingRequired = items.filter((i) => i.required && !i.ok).map((i) => i.label);
  const warnings = items.filter((i) => !i.required && !i.ok).map((i) => i.hint as string);
  const fixes = [
    ...items.filter((i) => i.required && !i.ok).map((i) => `【必补】${i.label}：${i.hint}`),
    ...items.filter((i) => i.required && i.ok && i.hint).map((i) => `【建议】${i.label}：${i.hint}`),
    ...items.filter((i) => !i.required && !i.ok).map((i) => `【建议】${i.label}：${i.hint}`),
  ];
  const canIssue = missingRequired.length === 0;

  const headline = canIssue
    ? `✅ 十要素必填项齐全，可以审核发出${warnings.length ? `；${warnings.length} 项可选项没填，发之前看一眼建议` : ""}。发出后要书面回签，回签的交期才登跟单表`
    : `⛔ 还不能发：缺 ${missingRequired.length} 项必填（${missingRequired.join("、")}）。补齐再审核，别先发再补`;

  const esc = (s: string) => s.replace(/\|/g, "／").replace(/\r?\n/g, " ");
  const markdown = `| # | 要素 | 必填 | 结果 | 当前值 | 怎么补 |\n|---|---|---|---|---|---|\n` +
    items.map((i, idx) => `| ${idx + 1} | ${i.label} | ${i.required ? "是" : "否"} | ${i.ok ? "✅" : i.required ? "⛔ 缺" : "⚠️ 空"} | ${esc(i.value)} | ${esc(i.hint ?? "")} |`).join("\n");

  return { canIssue, items, missingRequired, warnings, fixes, headline, markdown };
}
