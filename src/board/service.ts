// 看板的「数据管道」：把资料库里的表喂给领域逻辑，把结果落 SQLite，再读回来给界面。
// 领域逻辑（score/generate/rules/day）是纯函数、有单测；这一层只管 IO 与降级，故意不含业务判断。
import { desktop, isDesktop } from "../data/bridge";
import { db } from "../db/schema";
import type { BoardDay, BoardTask } from "./types";

const today = () => new Date().toISOString().slice(0, 10);

/** 资料库里的表 → generateTasks 需要的入参。role 是导入时打的标，doc 类不参与。 */
async function collectSource() {
  const mats = await db.materials.toArray();
  const rowsOf = (pred: (name: string, role: string) => boolean) =>
    mats.filter((m) => pred(m.name ?? "", m.role ?? "")).flatMap((m) => m.rows ?? []) as Record<string, string>[];
  const has = (name: string, ...kw: string[]) => kw.some((k) => name.includes(k));
  return {
    production: rowsOf((n) => has(n, "生产", "排产", "需求", "MRP")),
    addon: rowsOf((n) => has(n, "加单", "插单", "急件")),
    poLines: rowsOf((n, r) => r === "tracking" || has(n, "订单", "执行", "跟单", "PO")),
    arrivals: rowsOf((n) => has(n, "到货", "入库", "收货")),
    inventory: rowsOf((n) => has(n, "现存", "库存", "可用")),
    materials: rowsOf((_n, r) => r === "materials"),
  };
}

export interface BoardSnapshot {
  bizDate: string;
  tasks: BoardTask[];
  ordered: BoardTask[];
  top3: BoardTask[];
  groups: { supplier: string; taskIds: string[] }[];
  day: { items: { id: string; text: string; auto?: boolean; satisfied: boolean; detail?: string }[]; canClose: boolean; handoverText: string };
  warnings: string[];
}

export async function loadBoard(bizDate = today()): Promise<BoardSnapshot> {
  const { rankTasks } = await import("./rules");
  const { evaluateDay } = await import("./day");
  const tasks = isDesktop() ? await desktop().call<BoardTask[]>("board.list", { bizDate }) : [];
  const dayRow = isDesktop() ? await desktop().call<BoardDay>("board.getDay", bizDate) : { bizDate, checklist: {} };
  const { ordered, top3, groups } = rankTasks(tasks);
  return { bizDate, tasks, ordered, top3, groups, day: evaluateDay(tasks, dayRow.checklist ?? {}, bizDate), warnings: [] };
}

/** 重新从资料库生成今天的卡片。已经动过的卡（doing/done + 勾过的步骤）保留状态，不被覆盖。 */
export async function rebuildBoard(bizDate = today()): Promise<BoardSnapshot> {
  if (!isDesktop()) throw new Error("工作看板是桌面版功能（要本地数据库存任务状态）。网页版可以先用对话问采姐。");
  const { generateTasks } = await import("./generate");
  const src = await collectSource();
  const { tasks: fresh, warnings } = generateTasks(src, bizDate);
  const old = await desktop().call<BoardTask[]>("board.list", { bizDate });
  const byId = new Map(old.map((t) => [t.id, t]));
  const merged = fresh.map((t) => {
    const prev = byId.get(t.id);
    return prev ? { ...t, status: prev.status, doneSteps: prev.doneSteps ?? [], note: prev.note, closedAt: prev.closedAt } : t;
  });
  // 上一轮生成过、这轮数据里已经不存在的卡：不硬删（她可能正做到一半），标成 dropped 让界面收起来
  const freshIds = new Set(merged.map((t) => t.id));
  const stale = old.filter((t) => !freshIds.has(t.id) && t.status !== "done").map((t) => ({ ...t, status: "dropped" as const, updatedAt: Date.now() }));
  await desktop().call("board.upsert", [...merged, ...stale]);
  const snap = await loadBoard(bizDate);
  return { ...snap, warnings };
}

export async function toggleStep(taskId: string, stepId: string, done: boolean, tasks: BoardTask[]) {
  const t = tasks.find((x) => x.id === taskId);
  if (!t) return;
  const set = new Set(t.doneSteps ?? []);
  done ? set.add(stepId) : set.delete(stepId);
  await desktop().call("board.update", taskId, { doneSteps: [...set], status: t.status === "todo" ? "doing" : t.status });
}

export async function setTaskStatus(taskId: string, status: BoardTask["status"], note?: string) {
  await desktop().call("board.update", taskId, { status, note, closedAt: status === "done" ? Date.now() : null });
}

export async function setCheck(bizDate: string, itemId: string, checked: boolean) {
  const day = await desktop().call<BoardDay>("board.getDay", bizDate);
  await desktop().call("board.setDay", { ...day, checklist: { ...(day.checklist ?? {}), [itemId]: checked } });
}

export async function closeDay(bizDate: string) {
  const day = await desktop().call<BoardDay>("board.getDay", bizDate);
  await desktop().call("board.setDay", { ...day, closedAt: Date.now() });
}
