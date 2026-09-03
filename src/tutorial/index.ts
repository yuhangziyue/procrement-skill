// 教程模块的对外入口：只做再导出 + 几个查询辅助函数，不放业务逻辑。
export * from "./content";

import { TUTORIALS, type Confidence, type Tutorial } from "./content";

export const CATEGORY_ORDER: Tutorial["category"][] = ["query", "export", "import", "flow"];

export const CATEGORY_LABELS: Record<Tutorial["category"], string> = {
  query: "查询",
  export: "导出",
  import: "导入",
  flow: "单据流",
};

export const CONFIDENCE_LABELS: Record<Confidence, string> = {
  verified: "✅ 多来源确认",
  unverified: "⚠️ 单来源，实机核对",
  unknown: "❌ 路径未知，请帮我确认",
};

export const CONFIDENCE_BADGES: Record<Confidence, string> = {
  verified: "✅",
  unverified: "⚠️",
  unknown: "❌",
};

export interface TutorialGroup {
  category: Tutorial["category"];
  label: string;
  items: Tutorial[];
}

/** 按 category 分组，保持固定的展示顺序，空分组不返回。 */
export function groupByCategory(tutorials: Tutorial[] = TUTORIALS): TutorialGroup[] {
  return CATEGORY_ORDER.map((category) => ({
    category,
    label: CATEGORY_LABELS[category],
    items: tutorials.filter((t) => t.category === category),
  })).filter((g) => g.items.length > 0);
}

/** 按 id 查一篇教程。 */
export function findTutorial(id: string, tutorials: Tutorial[] = TUTORIALS): Tutorial | undefined {
  return tutorials.find((t) => t.id === id);
}

const norm = (s: string) => s.toLowerCase().trim();

/** 标题 / 步骤标题与说明 / 坑 全文 includes 过滤，空关键词返回全部。 */
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
