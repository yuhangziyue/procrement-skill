// 教程模块的对外入口：只做再导出 + 几个查询辅助函数，不放业务逻辑。
export * from "./content";
export * from "./sources";

import { TUTORIALS, type Confidence, type Stage, type Tutorial } from "./content";
import { SOURCES, SOURCE_KIND_ORDER, SOURCE_KIND_LABELS, type Source, type SourceKind } from "./sources";

/** 展示顺序 = 采购闭环的顺序。basics 压在最后：它是随时回来查的通识，不是流程里的一环。 */
export const STAGE_ORDER: Stage[] = ["plan", "order", "confirm", "track", "receive", "settle", "basics"];

export const STAGE_LABELS: Record<Stage, string> = {
  plan: "需求与算量",
  order: "下单与审批",
  confirm: "回签与变更",
  track: "在途与催货",
  receive: "到货入库",
  settle: "对账结算",
  basics: "系统通识",
};

/** 每组一句「什么时候看这组」，让人一眼判断自己卡在哪。 */
export const STAGE_HINTS: Record<Stage, string> = {
  plan: "拿到生产表，还不知道该下多少、最晚哪天下",
  order: "量定了，要把它变成一张供应商认账的订单",
  confirm: "单发出去了，回签没拿到，或者情况变了要改单",
  track: "已确认未到货，盯发运、盯到期、催起来",
  receive: "货到厂了，验收、入库、差异处理",
  settle: "月底了，暂估、发票、对账、结账",
  basics: "任何时候卡在系统本身：菜单、导出、导入、权限",
};

/** 教程阶段 → 看板泳道。plan 的活最终落在「要下单」，settle 不进泳道，落当日收工清单。 */
export const STAGE_TO_LANE: Record<Stage, "order" | "confirm" | "transit" | "inbound" | null> = {
  plan: "order",
  order: "order",
  confirm: "confirm",
  track: "transit",
  receive: "inbound",
  settle: null,
  basics: null,
};

export const CONFIDENCE_LABELS: Record<Confidence, string> = {
  verified: "多来源确认",
  unverified: "单来源，实机核对",
  unknown: "路径未知，请帮我确认",
};

export interface TutorialGroup {
  stage: Stage;
  label: string;
  hint: string;
  items: Tutorial[];
}

/** 按 stage 分组，保持采购闭环的展示顺序，空分组不返回。 */
export function groupByStage(tutorials: Tutorial[] = TUTORIALS): TutorialGroup[] {
  return STAGE_ORDER.map((stage) => ({
    stage,
    label: STAGE_LABELS[stage],
    hint: STAGE_HINTS[stage],
    items: tutorials.filter((t) => t.stage === stage),
  })).filter((g) => g.items.length > 0);
}

/** 按 id 查一篇教程。 */
export function findTutorial(id: string, tutorials: Tutorial[] = TUTORIALS): Tutorial | undefined {
  return tutorials.find((t) => t.id === id);
}

/** 把一串 id 解析成教程对象，查不到的直接丢掉（测试会保证不存在这种情况）。 */
export function resolveTutorials(ids: string[] | undefined, tutorials: Tutorial[] = TUTORIALS): Tutorial[] {
  return (ids ?? []).map((id) => findTutorial(id, tutorials)).filter((t): t is Tutorial => !!t);
}

const norm = (s: string) => s.toLowerCase().trim();

/** 标题 / 目标 / 场景 / 步骤标题与说明 / 坑 全文 includes 过滤，空关键词返回全部。 */
export function searchTutorials(query: string, tutorials: Tutorial[] = TUTORIALS): Tutorial[] {
  const q = norm(query);
  if (!q) return tutorials;
  return tutorials.filter((t) => {
    if (norm(t.title).includes(q) || norm(t.goal).includes(q) || norm(t.scene).includes(q)) return true;
    return t.steps.some(
      (s) =>
        norm(s.title).includes(q) ||
        norm(s.detail).includes(q) ||
        (s.pitfall != null && norm(s.pitfall).includes(q)),
    );
  });
}

// ---- 信源库的查询辅助 ----

export interface SourceGroup {
  kind: SourceKind;
  label: string;
  items: Source[];
}

/** 按 kind 分组，空分组不返回。 */
export function groupSourcesByKind(sources: Source[] = SOURCES): SourceGroup[] {
  return SOURCE_KIND_ORDER.map((kind) => ({
    kind,
    label: SOURCE_KIND_LABELS[kind],
    items: sources.filter((s) => s.kind === kind),
  })).filter((g) => g.items.length > 0);
}

/** 标题 / 作者 / 出版社 / 用途 全文 includes 过滤，空关键词返回全部。 */
export function searchSources(query: string, sources: Source[] = SOURCES): Source[] {
  const q = norm(query);
  if (!q) return sources;
  return sources.filter((s) =>
    norm([s.title, s.author ?? "", s.publisher ?? "", s.why, s.isbn ?? ""].join(" ")).includes(q),
  );
}
