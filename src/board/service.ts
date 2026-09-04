// 看板的「数据管道」：把资料库里的表喂给领域逻辑，把结果落 SQLite，再读回来给界面。
// 领域逻辑（score/generate/rules/day）是纯函数、有单测；这一层只管 IO 与降级，故意不含业务判断。
import { desktop, isDesktop } from "../data/bridge";
import { db } from "../db/schema";
import type { Band, BoardDay, BoardTask, EditableFields, TaskEvent } from "./types";
import { newId } from "../util/id";

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
  /** 三档分区后的卡片。v2 起工作台按 band 分区，档内按 score 排序 */
  byBand: Record<Band, BoardTask[]>;
  groups: { supplier: string; taskIds: string[] }[];
  day: { items: { id: string; text: string; auto?: boolean; satisfied: boolean; detail?: string }[]; canClose: boolean; handoverText: string };
  warnings: string[];
}

export async function loadBoard(bizDate = today()): Promise<BoardSnapshot> {
  const { rankTasks } = await import("./rules");
  const { evaluateDay } = await import("./day");
  const { bandOf } = await import("./band");
  const raw = isDesktop() ? await desktop().call<BoardTask[]>("board.list", { bizDate }) : [];
  const dayRow = isDesktop() ? await desktop().call<BoardDay>("board.getDay", bizDate) : { bizDate, checklist: {} };

  // v2 迁移的回填：老卡片没有 band，分不进任何一档就会在界面上凭空消失。
  // 这里算一次并写回库，下次直接读——band 是排布依据，不该每次渲染现算。
  const missing: BoardTask[] = [];
  const tasks = raw.map((t) => {
    if (t.band) return t;
    const r = bandOf(t, { bizDate });
    const filled = { ...t, band: r.band, bandRule: r.ruleId, bandWhy: r.why };
    missing.push(filled);
    return filled;
  });
  if (missing.length && isDesktop()) {
    await desktop().call("board.upsert", missing).catch((e) => console.warn("回填 band 失败（不影响本次渲染）", e));
  }

  const { byBand, groups } = rankTasks(tasks);
  return { bizDate, tasks, byBand, groups, day: evaluateDay(tasks, dayRow.checklist ?? {}, bizDate), warnings: [] };
}

/** 重新从资料库生成今天的卡片。已经动过的卡（doing/done + 勾过的步骤）保留状态，不被覆盖。 */
export async function rebuildBoard(bizDate = today()): Promise<BoardSnapshot> {
  if (!isDesktop()) throw new Error("工作看板是桌面版功能（要本地数据库存任务状态）。网页版可以先用对话问采姐。");
  const { generateTasks } = await import("./generate");
  const src = await collectSource();
  const { tasks: fresh, warnings } = generateTasks(src, bizDate);
  const old = await desktop().call<BoardTask[]>("board.list", { bizDate });
  const byId = new Map(old.map((t) => [t.id, t]));
  // 重算时保住她已经动过的东西：状态、勾过的步骤、写过的判断层字段、填过的凭据、跟进记录。
  // 事实层（数量、日期、金额）永远以新导入的数据为准——那本来就该跟着 U8 走。
  const merged = fresh.map((t) => {
    const prev = byId.get(t.id);
    if (!prev) return t;
    return {
      ...t,
      status: prev.status,
      doneSteps: prev.doneSteps ?? [],
      note: prev.note,
      closedAt: prev.closedAt,
      editable: { ...(t.editable ?? {}), ...(prev.editable ?? {}) },
      doneEvidence: { ...(t.doneEvidence ?? {}), ...(prev.doneEvidence ?? {}) },
      events: prev.events ?? [],
    };
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


/** 判断层 / 过程层字段的就地编辑。事实层字段不走这条路——它们根本不在 EditableFields 里。 */
export async function editTask(taskId: string, patch: Partial<EditableFields>, tasks: BoardTask[]) {
  const cur = tasks.find((t) => t.id === taskId);
  await desktop().call("board.update", taskId, { editable: { ...(cur?.editable ?? {}), ...patch } });
}

/** 主操作完成：凭据填齐才算做完，完成态由程序判定而不是她自己勾「干完了」 */
export async function completeTask(taskId: string, evidence: Record<string, string>) {
  await desktop().call("board.update", taskId, { doneEvidence: evidence, status: "done", closedAt: Date.now() });
}

/** 加一条跟进记录。留痕是采购的命——谁、什么时候、什么渠道、说了什么。 */
export async function addTaskEvent(taskId: string, ev: Omit<TaskEvent, "id" | "taskId" | "at"> & { at?: string }) {
  const row: TaskEvent = { id: newId(), taskId, at: ev.at ?? new Date().toISOString(), channel: ev.channel, counterpart: ev.counterpart, content: ev.content, newPromiseDate: ev.newPromiseDate };
  await desktop().call("board.addEvent", row);
  // 对方给了新的承诺日期就顺手写进判断层，并标明来源是口头——只有书面回签才参与打分
  if (ev.newPromiseDate) {
    const cur = await desktop().call<BoardTask[]>("board.list", { bizDate: undefined });
    const t = cur.find((x) => x.id === taskId);
    await desktop().call("board.update", taskId, {
      editable: { ...(t?.editable ?? {}), promiseDate: ev.newPromiseDate, promiseSource: "verbal" },
    });
  }
  return row;
}
