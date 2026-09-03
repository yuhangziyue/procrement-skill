// 增强卡读写。规则（评审已定）：
// - 冲突不自动覆盖：新卡触发词与已启用卡重叠（相同或互为子串）⇒ 双向写 conflictsWith，由用户点选哪张生效
// - builtin 卡可停用、不可删除、不可编辑正文；user / taught 卡可编辑可删
// - 「教它」产出的草稿必须经预览确认后才调用 saveEnhancement(origin:"taught")
import { db, type EnhancementRow } from "./schema";
import { newId } from "../util/id";

/** 落库前的草稿：没有 id / 时间戳 / conflictsWith（这三项由 saveEnhancement 生成） */
export type EnhancementDraft = Omit<EnhancementRow, "id" | "createdAt" | "updatedAt" | "conflictsWith">;

// ---------- 纯函数（可测） ----------

const norm = (s: string) => s.trim().toLowerCase();

/** 两个触发词是否重叠：相同，或互为子串（都先 trim + 小写；空串不算） */
export function triggersOverlap(a: string, b: string): boolean {
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return false;
  return x === y || x.includes(y) || y.includes(x);
}

/** 两张卡的触发词列表是否有任一对重叠 */
export function cardsOverlap(a: readonly string[], b: readonly string[]): boolean {
  return a.some((ta) => b.some((tb) => triggersOverlap(ta, tb)));
}

/**
 * 找出与草稿触发词重叠的已启用卡。
 * - 只看 enabled 的卡（停用的不会实际生效，不算冲突）
 * - 草稿若带 id（编辑场景），排除自己
 */
export function findConflicts(
  draft: Pick<EnhancementDraft, "triggers"> & { id?: string },
  existing: readonly EnhancementRow[],
): EnhancementRow[] {
  return existing.filter((e) => e.enabled && e.id !== draft.id && cardsOverlap(draft.triggers, e.triggers));
}

const ORIGIN_RANK: Record<EnhancementRow["origin"], number> = { taught: 0, user: 1, builtin: 2 };

/** 排序：taught 最前、builtin 最后；组内按 updatedAt 倒序 */
export function compareEnhancements(a: EnhancementRow, b: EnhancementRow): number {
  const r = ORIGIN_RANK[a.origin] - ORIGIN_RANK[b.origin];
  return r !== 0 ? r : b.updatedAt - a.updatedAt;
}

/** 去空、去重、trim 的触发词/行列表清洗 */
export function cleanLines(lines: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of lines) {
    const s = raw.trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

// ---------- 库操作 ----------

const addTo = (arr: string[], id: string) => (arr.includes(id) ? arr : [...arr, id]);
const removeFrom = (arr: string[], id: string) => arr.filter((x) => x !== id);

/** 把 rowId 与 conflictIds 之间的冲突双向写入（在事务内调用） */
async function linkConflicts(rowId: string, conflictIds: string[], now: number) {
  for (const cid of conflictIds) {
    const other = await db.enhancements.get(cid);
    if (!other) continue;
    await db.enhancements.update(cid, { conflictsWith: addTo(other.conflictsWith ?? [], rowId), updatedAt: now });
  }
}

/** 把 rowId 从所有其它卡的 conflictsWith 里摘掉（在事务内调用） */
async function unlinkAll(rowId: string, now: number) {
  const others = await db.enhancements.filter((e) => (e.conflictsWith ?? []).includes(rowId)).toArray();
  for (const o of others) {
    await db.enhancements.update(o.id, { conflictsWith: removeFrom(o.conflictsWith, rowId), updatedAt: now });
  }
}

/**
 * 写入一张新卡（预览确认后调用）。
 * 若草稿 enabled 且触发词与已启用卡重叠：不覆盖，双向写 conflictsWith，返回 conflicts 让 UI 标黄。
 */
export async function saveEnhancement(draft: EnhancementDraft): Promise<{ row: EnhancementRow; conflicts: EnhancementRow[] }> {
  const now = Date.now();
  return db.transaction("rw", db.enhancements, async () => {
    const existing = await db.enhancements.toArray();
    const conflicts = draft.enabled ? findConflicts(draft, existing) : [];
    const row: EnhancementRow = {
      ...draft,
      name: draft.name.trim(),
      intents: cleanLines(draft.intents),
      triggers: cleanLines(draft.triggers),
      sop: cleanLines(draft.sop),
      cautions: cleanLines(draft.cautions),
      examples: cleanLines(draft.examples),
      id: newId(),
      conflictsWith: conflicts.map((c) => c.id),
      createdAt: now,
      updatedAt: now,
    };
    await db.enhancements.add(row);
    await linkConflicts(row.id, row.conflictsWith, now);
    return { row, conflicts };
  });
}

/**
 * 编辑正文（name / intents / triggers / sop / cautions / examples / enabled）。
 * builtin 卡拒绝编辑正文（只能通过 toggleEnhancement 启停）。触发词变化会重新计算冲突。
 */
export async function updateEnhancement(
  id: string,
  patch: Partial<EnhancementDraft>,
): Promise<{ row: EnhancementRow; conflicts: EnhancementRow[] }> {
  const now = Date.now();
  return db.transaction("rw", db.enhancements, async () => {
    const cur = await db.enhancements.get(id);
    if (!cur) throw new Error("增强卡不存在");
    if (cur.origin === "builtin") throw new Error("内置卡不可编辑正文，只能停用");
    const merged: EnhancementRow = {
      ...cur,
      ...patch,
      origin: cur.origin, // 来源不可改
      name: (patch.name ?? cur.name).trim(),
      intents: cleanLines(patch.intents ?? cur.intents),
      triggers: cleanLines(patch.triggers ?? cur.triggers),
      sop: cleanLines(patch.sop ?? cur.sop),
      cautions: cleanLines(patch.cautions ?? cur.cautions),
      examples: cleanLines(patch.examples ?? cur.examples),
      updatedAt: now,
    };
    // 冲突关系整体重算：先解绑旧的，再按新触发词绑
    await unlinkAll(id, now);
    const existing = await db.enhancements.toArray();
    const conflicts = merged.enabled ? findConflicts({ id, triggers: merged.triggers }, existing) : [];
    merged.conflictsWith = conflicts.map((c) => c.id);
    await db.enhancements.put(merged);
    await linkConflicts(id, merged.conflictsWith, now);
    return { row: merged, conflicts };
  });
}

/**
 * 启停。停用 ⇒ 该卡不再与任何卡冲突（两边都清）；启用 ⇒ 重新计算冲突并双向写入。
 * 返回启用后新产生的冲突（停用时为空数组）。
 */
export async function toggleEnhancement(id: string, enabled: boolean): Promise<EnhancementRow[]> {
  const now = Date.now();
  return db.transaction("rw", db.enhancements, async () => {
    const cur = await db.enhancements.get(id);
    if (!cur) throw new Error("增强卡不存在");
    await unlinkAll(id, now);
    let conflicts: EnhancementRow[] = [];
    if (enabled) {
      const existing = await db.enhancements.toArray();
      conflicts = findConflicts({ id, triggers: cur.triggers }, existing);
    }
    await db.enhancements.update(id, { enabled, conflictsWith: conflicts.map((c) => c.id), updatedAt: now });
    await linkConflicts(id, conflicts.map((c) => c.id), now);
    return conflicts;
  });
}

/** 用户点选：keep 生效、drop 停用（保留可回退），清两边的这对冲突记录 */
export async function resolveConflict(keepId: string, dropId: string): Promise<void> {
  const now = Date.now();
  await db.transaction("rw", db.enhancements, async () => {
    const keep = await db.enhancements.get(keepId);
    const drop = await db.enhancements.get(dropId);
    if (!keep || !drop) throw new Error("增强卡不存在");
    // drop 停用后与所有卡都不再冲突
    await unlinkAll(dropId, now);
    await db.enhancements.update(dropId, { enabled: false, conflictsWith: [], updatedAt: now });
    await db.enhancements.update(keepId, { enabled: true, conflictsWith: removeFrom(keep.conflictsWith ?? [], dropId), updatedAt: now });
  });
}

/** 删除。builtin 拒绝；同时把它从其它卡的 conflictsWith 里摘掉 */
export async function deleteEnhancement(id: string): Promise<void> {
  const now = Date.now();
  await db.transaction("rw", db.enhancements, async () => {
    const cur = await db.enhancements.get(id);
    if (!cur) return;
    if (cur.origin === "builtin") throw new Error("内置卡不可删除，只能停用");
    await unlinkAll(id, now);
    await db.enhancements.delete(id);
  });
}

/** 全部卡：taught 排前、builtin 排后，组内按 updatedAt 倒序 */
export async function listEnhancements(): Promise<EnhancementRow[]> {
  const rows = await db.enhancements.toArray();
  return rows.sort(compareEnhancements);
}
