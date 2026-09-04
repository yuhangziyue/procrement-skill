// 排序与硬规则（苏姐 spec-su.md §4 的 R1~R4）。
// R1（逾期 + 断线 → +100 置顶）在 score.ts 里就加进分数了，这里只负责排、只负责分组，不再改分。
//
// 这一层唯一的硬要求是：**同样一批卡，无论以什么顺序传进来，出来的顺序必须一模一样**。
// 她昨天记住的顺序今天不能莫名其妙变——所以比较链一路兜到 id（唯一），构成全序，不依赖 Array#sort 的稳定性。
import { BANDS, type Band, type BoardTask } from "./types";

/** 排最后的日期占位：没填需求日的卡不能因为「空」而插队 */
const FAR_FUTURE = "9999-12-31";

/** 状态桶：能动的排前面，干完的收后面，作废的垫底 */
const STATUS_RANK: Record<BoardTask["status"], number> = { todo: 0, doing: 0, done: 1, dropped: 2 };

/** 需要「打电话/发消息给供应商」的卡才值得并组：下单是自己在 U8 里干的活，并不进同一通电话 */
const CALLABLE = new Set<BoardTask["kind"]>(["T4_unconfirmed", "T5_transit", "T8_overdue", "T9_discrepancy", "T7_not_stocked"]);

/** R4 的比较链：状态桶 → 分数降序 → 需求日升序 → 物料编码升序 → id 升序 */
export function compareTasks(a: BoardTask, b: BoardTask): number {
  const s = STATUS_RANK[a.status] - STATUS_RANK[b.status];
  if (s !== 0) return s;
  const d = (b.score ?? 0) - (a.score ?? 0);
  if (d !== 0) return d;
  const na = (a.needDate || a.dueDate || FAR_FUTURE), nb = (b.needDate || b.dueDate || FAR_FUTURE);
  if (na !== nb) return na < nb ? -1 : 1;
  const ma = a.materialCode ?? "", mb = b.materialCode ?? "";
  if (ma !== mb) return ma < mb ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

const isActive = (t: BoardTask) => t.status === "todo" || t.status === "doing";

/** 档序：紧急 → 日常跟进 → 提醒。band 决定分区，score 只在档内说话——两者打架时 band 赢。 */
export const BAND_ORDER: Band[] = BANDS.map((b) => b.id);

export interface RankResult {
  /** 三个分区，每区内部按 compareTasks 全序排好。这是界面唯一该消费的结构 */
  byBand: Record<Band, BoardTask[]>;
  /** 三区首尾相接的平铺视图（收工三句话、导出这类场景要一条线的顺序） */
  ordered: BoardTask[];
  groups: { supplier: string; taskIds: string[] }[];
}

/**
 * 先按 band 分三桶，再桶内按 compareTasks 排。
 * 「今天三件事」横幅已砍——urgent 分区本身就是横幅，一屏两处置顶是重复。
 */
export function rankTasks(tasks: BoardTask[]): RankResult {
  const sorted = [...tasks].sort(compareTasks);
  const byBand = { urgent: [] as BoardTask[], follow: [] as BoardTask[], notice: [] as BoardTask[] } satisfies Record<Band, BoardTask[]>;
  for (const t of sorted) byBand[t.band ?? "notice"].push(t);
  const ordered = BAND_ORDER.flatMap((b) => byBand[b]);

  // R2 合并：同一供应商 ≥2 张活卡 → 一次沟通解决三张单。
  // 只打组标记，**不删卡、不造合并卡**——一张卡只能有一个家（苏姐 §3.2）。
  const bySupplier = new Map<string, BoardTask[]>();
  for (const t of ordered) {
    const s = (t.supplier ?? "").trim();
    if (!s || !isActive(t)) continue;
    // 只把「要跟人说话」的卡并组：下单类是自己在 U8 里操作，并不进同一通电话
    if (!CALLABLE.has(t.kind)) continue;
    (bySupplier.get(s) ?? bySupplier.set(s, []).get(s)!).push(t);
  }
  const groups = [...bySupplier.entries()]
    .filter(([, arr]) => arr.length >= 2)
    .map(([supplier, arr]) => ({ supplier, taskIds: arr.map((t) => t.id) }))
    // 组内最高分代表这一组，组间按代表分排；同分按供应商名兜底，保证稳定
    .sort((x, y) => {
      const sx = Math.max(...x.taskIds.map((id) => tasks.find((t) => t.id === id)?.score ?? 0));
      const sy = Math.max(...y.taskIds.map((id) => tasks.find((t) => t.id === id)?.score ?? 0));
      return sy - sx || (x.supplier < y.supplier ? -1 : x.supplier > y.supplier ? 1 : 0);
    });

  return { byBand, ordered, groups };
}

/** 给界面用：某张卡属于哪一组（一次沟通能顺带解决的伙伴） */
export function groupMatesOf(taskId: string, groups: RankResult["groups"]): string[] {
  const g = groups.find((x) => x.taskIds.includes(taskId));
  return g ? g.taskIds.filter((id) => id !== taskId) : [];
}

/** 合并沟通的开场白：一个电话解决三张单，比打三通电话省时间也省人情 */
export function groupOpeningLine(supplier: string, tasks: BoardTask[]): string {
  const list = tasks.map((t, i) => `${i + 1}）${[t.poNo, t.materialName ?? t.materialCode].filter(Boolean).join(" ")}`).join("，");
  return `${supplier}，有 ${tasks.length} 笔想跟你一次对完：${list}。麻烦一笔一笔给我准数——数量、到货日期，我这边记一下。`;
}
