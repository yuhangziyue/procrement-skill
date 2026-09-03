// 回复反馈：👍/👎、备注、「已采用」（工具结果卡，北极星辅助指标）。同一 messageId 只留一条。
import { getISOWeek, getISOWeekYear } from "date-fns";
import { db, type FeedbackRow } from "./schema";
import { newId } from "../util/id";

/** 投票。同一 messageId 覆盖（保留原 id 与 adopted，刷新 vote / note / createdAt） */
export async function vote(messageId: string, sessionId: string, vote: 1 | -1, note?: string): Promise<FeedbackRow> {
  const now = Date.now();
  return db.transaction("rw", db.feedback, async () => {
    const cur = await db.feedback.where("messageId").equals(messageId).first();
    const trimmed = note?.trim() || undefined;
    const row: FeedbackRow = cur
      ? { ...cur, sessionId, vote, note: trimmed ?? cur.note, createdAt: now }
      : { id: newId(), messageId, sessionId, vote, note: trimmed, createdAt: now };
    await db.feedback.put(row);
    return row;
  });
}

/**
 * 标记「已采用」。
 * 没有投过票时点采用 ⇒ 新建一条 vote:1 的记录（采用即认可；schema 里 vote 必填）；
 * 没有记录且取消采用 ⇒ 无事发生。
 */
export async function markAdopted(messageId: string, sessionId: string, adopted: boolean): Promise<FeedbackRow | undefined> {
  const now = Date.now();
  return db.transaction("rw", db.feedback, async () => {
    const cur = await db.feedback.where("messageId").equals(messageId).first();
    if (!cur) {
      if (!adopted) return undefined;
      const row: FeedbackRow = { id: newId(), messageId, sessionId, vote: 1, adopted: true, createdAt: now };
      await db.feedback.put(row);
      return row;
    }
    const row: FeedbackRow = { ...cur, adopted };
    await db.feedback.put(row);
    return row;
  });
}

/** 某会话的全部反馈，按 messageId 索引 */
export async function getFeedbackFor(sessionId: string): Promise<Map<string, FeedbackRow>> {
  const rows = await db.feedback.where("sessionId").equals(sessionId).toArray();
  return new Map(rows.map((r) => [r.messageId, r]));
}

export interface FeedbackStats {
  up: number;
  down: number;
  adopted: number;
  /** 有反馈或有会话活动的不同 ISO 周数（会话按 sessions.updatedAt 粗算） */
  weeksActive: number;
}

/** ISO 周键，如 "2026-W36"（周年与自然年在跨年周不同，用 getISOWeekYear） */
export const isoWeekKey = (ts: number): string => {
  const d = new Date(ts);
  return `${getISOWeekYear(d)}-W${String(getISOWeek(d)).padStart(2, "0")}`;
};

export const countDistinctWeeks = (timestamps: Iterable<number>): number => {
  const s = new Set<string>();
  for (const t of timestamps) if (Number.isFinite(t) && t > 0) s.add(isoWeekKey(t));
  return s.size;
};

export async function feedbackStats(): Promise<FeedbackStats> {
  const [fb, sessions] = await Promise.all([db.feedback.toArray(), db.sessions.toArray()]);
  let up = 0;
  let down = 0;
  let adopted = 0;
  for (const r of fb) {
    if (r.vote === 1) up++;
    else if (r.vote === -1) down++;
    if (r.adopted) adopted++;
  }
  const weeksActive = countDistinctWeeks([...fb.map((r) => r.createdAt), ...sessions.map((s) => s.updatedAt)]);
  return { up, down, adopted, weeksActive };
}
