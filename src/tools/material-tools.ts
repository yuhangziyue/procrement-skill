// 依赖用户导入资料的四个工具：查物料 / PO 十要素 / 到货预告 / 跟单三色。
// 资料从 IndexedDB materials 表取该角色最新版本；没导入就明确告诉模型「让用户先去资料库导入」。
import { Type, type Static } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { db, type MaterialRow } from "../db/schema";
import { lookupMaterial } from "./lookup-material";
import { checkPo } from "./check-po";
import { arrivalNotice } from "./arrival-notice";
import { trackStatus } from "./track-status";

async function latestRows(role: MaterialRow["role"]): Promise<Record<string, string>[] | undefined> {
  const all = await db.materials.where("role").equals(role).toArray();
  if (!all.length) return undefined;
  const latest = all.reduce((a, b) => (b.version > a.version ? b : a));
  return latest.rows ?? [];
}

const NO_MATERIAL: Record<MaterialRow["role"], string> = {
  materials: "还没有导入物料表。请让用户在「资料库」导入物料清单（模板 templates/material-list-template.csv），再查。",
  tracking: "还没有导入跟单表。请让用户在「资料库」导入跟单表或订单执行报表（模板 templates/tracking-sheet-template.csv）。",
  suppliers: "还没有导入供应商档案。",
  doc: "没有该文档。",
};

const todayStr = () => new Date().toISOString().slice(0, 10);

const LookupParams = Type.Object({
  code: Type.Optional(Type.String({ description: "存货编码（优先）" })),
  name: Type.Optional(Type.String({ description: "物料名称（模糊）" })),
});
export const lookupMaterialTool: AgentTool<typeof LookupParams> = {
  name: "lookup_material",
  label: "查物料表",
  description: "按存货编码（优先）或名称查用户导入的物料表，返回供应商、采购状态和分流结论：✅可下 / ⛔停购拦截 / ➡️先问生产 / 确认是否还在用 / 需要需求来源。下单算量前先调它拿状态。",
  parameters: LookupParams,
  execute: async (_id, p: Static<typeof LookupParams>) => {
    const rows = await latestRows("materials");
    if (!rows) throw new Error(NO_MATERIAL.materials);
    const r = lookupMaterial(rows, p);
    const md = [r.headline, ...r.hits.map((h) => `- **${h.code}** ${h.name}｜${h.supplier}｜${h.status}${h.priority === "daily" ? "｜🔥日配" : ""} → ${h.conclusion}`), ...r.flags.map((f) => `⚠️ ${f}`)].join("\n");
    return { content: [{ type: "text", text: md }], details: { kind: "lookup_material", result: r } };
  },
};

const PoParams = Type.Object({
  code: Type.Optional(Type.String()), name: Type.Optional(Type.String()), spec: Type.Optional(Type.String()),
  qty: Type.Optional(Type.Number()), unit: Type.Optional(Type.String()),
  price: Type.Optional(Type.Number()), taxRate: Type.Optional(Type.Number({ description: "13 或 0.13" })), taxIncluded: Type.Optional(Type.Boolean()),
  deliveryDate: Type.Optional(Type.String({ description: "到货日期，精确到日" })), deliveryPlace: Type.Optional(Type.String()),
  receivingWindow: Type.Optional(Type.String()), packNote: Type.Optional(Type.String({ description: "凑整/包装说明" })),
  batchPlan: Type.Optional(Type.String()), qualityDocs: Type.Optional(Type.String({ description: "随货单证要求" })),
  penalty: Type.Optional(Type.String()), remark: Type.Optional(Type.String()),
});
export const checkPoTool: AgentTool<typeof PoParams> = {
  name: "check_po",
  label: "PO 十要素自查",
  description: "采购订单发出前逐项检查十要素（编码/名称规格、数量单位、单价税率含税口径、到货日期、到货地点、收货时间窗、凑整说明、分批计划、随货单证、违约条款）。必填缺项 ⇒ 不能发出，并给补法。用户说「订单写好了 / 要发给供应商了」就调。",
  parameters: PoParams,
  execute: async (_id, p: Static<typeof PoParams>) => {
    const r = checkPo(p);
    return { content: [{ type: "text", text: r.markdown }], details: { kind: "check_po", result: r } };
  },
};

const ArrivalParams = Type.Object({
  today: Type.Optional(Type.String({ description: "今天 YYYY-MM-DD，默认系统日期" })),
  targetDate: Type.Optional(Type.String({ description: "预告哪一天到的货，默认明天" })),
});
export const arrivalNoticeTool: AgentTool<typeof ArrivalParams> = {
  name: "arrival_notice",
  label: "明日到货预告",
  description: "从用户导入的跟单表里筛出「承诺交期 = 明天（或指定日）」且未完结的订单行，生成给仓库的六列到货预告表和开口话术。用户问「明天到什么货 / 要给仓库发预告」就调。",
  parameters: ArrivalParams,
  execute: async (_id, p: Static<typeof ArrivalParams>) => {
    const rows = await latestRows("tracking");
    if (!rows) throw new Error(NO_MATERIAL.tracking);
    const r = arrivalNotice(rows, p.today ?? todayStr(), { targetDate: p.targetDate });
    const md = [r.headline, "", r.markdown, "", r.message ? `**给仓库的话**：${r.message}` : "", ...r.flags.map((f) => `⚠️ ${f}`)].join("\n").trim();
    return { content: [{ type: "text", text: md }], details: { kind: "arrival_notice", result: r } };
  },
};

const TrackParams = Type.Object({ today: Type.Optional(Type.String({ description: "今天 YYYY-MM-DD" })) });
export const trackStatusTool: AgentTool<typeof TrackParams> = {
  name: "track_status",
  label: "跟单三色判定",
  description: "把用户导入的跟单表逐行判成 🔴已逾期 / 🟡临期(≤3天) / 🟢未到期，每行给今天该做的动作。用户问「哪些单逾期了 / 今天该催谁 / 跟单情况」就调。",
  parameters: TrackParams,
  execute: async (_id, p: Static<typeof TrackParams>) => {
    const rows = await latestRows("tracking");
    if (!rows) throw new Error(NO_MATERIAL.tracking);
    const r = trackStatus(rows, p.today ?? todayStr());
    const md = [r.headline, "", r.markdown, ...r.flags.map((f) => `⚠️ ${f}`)].join("\n").trim();
    return { content: [{ type: "text", text: md }], details: { kind: "track_status", result: r } };
  },
};
