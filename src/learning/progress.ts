/**
 * 学习进度的读写。
 *
 * 桌面端走 SQLite（desktop().call("learn.list" / "learn.set")）；
 * 网页版降级到 localStorage，键 xiaocai.learning.progress。
 *
 * ⚠️ 这里**没有测验、没有及格线、没有打卡天数**（苏姐 §6 砍掉）。
 * score 字段保留，但只当「自评把握程度 1-5 星」用，而且**可以不填**——
 * 她在憋闷年，不能再给她一个能考砸的地方。
 */

import { desktop, isDesktop } from "../data/bridge";
import { ITEMS, TRACKS, TRACK_LABELS, type Track } from "./plan";

export type ItemStatus = "todo" | "doing" | "done";

export interface ProgressRow {
  itemId: string;
  status: ItemStatus;
  /** 自评把握程度 1-5，可为 null（跳过自评是正常的，不是缺失） */
  score: number | null;
  note: string | null;
  startedAt: string | null;
  doneAt: string | null;
  updatedAt: string;
}

export type Progress = Record<string, ProgressRow>;

export const PROGRESS_KEY = "xiaocai.learning.progress";

const now = () => new Date().toISOString();

function normalizeStatus(v: unknown): ItemStatus {
  return v === "doing" || v === "done" ? v : "todo";
}

function normalizeScore(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  if (!Number.isFinite(n)) return null;
  const i = Math.round(n);
  return i >= 1 && i <= 5 ? i : null;
}

function normalizeRow(raw: unknown): ProgressRow | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const itemId = typeof r.itemId === "string" ? r.itemId : "";
  if (!itemId) return undefined;
  const str = (v: unknown) => (typeof v === "string" && v ? v : null);
  return {
    itemId,
    status: normalizeStatus(r.status),
    score: normalizeScore(r.score),
    note: str(r.note),
    startedAt: str(r.startedAt),
    doneAt: str(r.doneAt),
    updatedAt: str(r.updatedAt) ?? now(),
  };
}

function readLocal(): Progress {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(PROGRESS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    const rows = Array.isArray(parsed) ? parsed : Object.values(parsed as Record<string, unknown>);
    const out: Progress = {};
    for (const r of rows) {
      const row = normalizeRow(r);
      if (row) out[row.itemId] = row;
    }
    return out;
  } catch {
    // 存坏了不要炸掉整个界面——当作没进度，她重新勾一遍就是
    return {};
  }
}

function writeLocal(p: Progress): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(Object.values(p)));
  } catch {
    /* 隐私模式 / 配额满：静默降级，不打断她 */
  }
}

/** 读全部进度。桌面端读 SQLite，网页版读 localStorage；任何异常都降级为空进度。 */
export async function loadProgress(): Promise<Progress> {
  if (isDesktop()) {
    try {
      const rows = await desktop().call<unknown[]>("learn.list");
      const out: Progress = {};
      for (const r of rows ?? []) {
        const row = normalizeRow(r);
        if (row) out[row.itemId] = row;
      }
      return out;
    } catch {
      return readLocal();
    }
  }
  return readLocal();
}

/**
 * 改一条的状态。
 * - todo → doing 时补 startedAt
 * - 任意 → done 时补 doneAt；done 退回时清掉 doneAt（允许反悔，不留惩罚痕迹）
 */
export async function setItemStatus(itemId: string, status: ItemStatus, note?: string): Promise<ProgressRow> {
  const all = await loadProgress();
  const prev = all[itemId];
  const row: ProgressRow = {
    itemId,
    status,
    score: prev?.score ?? null,
    note: note !== undefined ? (note.trim() ? note.trim() : null) : (prev?.note ?? null),
    startedAt: status === "todo" ? null : (prev?.startedAt ?? now()),
    doneAt: status === "done" ? (prev?.doneAt ?? now()) : null,
    updatedAt: now(),
  };
  await persist(all, row);
  return row;
}

/** 自评把握程度 1-5；传 null 表示"跳过自评"（合法，不是缺失） */
export async function setSelfRating(itemId: string, score: number | null): Promise<ProgressRow> {
  const all = await loadProgress();
  const prev = all[itemId];
  const row: ProgressRow = {
    itemId,
    status: prev?.status ?? "doing",
    score: score === null ? null : normalizeScore(score),
    note: prev?.note ?? null,
    startedAt: prev?.startedAt ?? now(),
    doneAt: prev?.doneAt ?? null,
    updatedAt: now(),
  };
  await persist(all, row);
  return row;
}

/** 记一笔（实操过程中的备注，不影响状态） */
export async function setItemNote(itemId: string, note: string): Promise<ProgressRow> {
  const all = await loadProgress();
  const prev = all[itemId];
  const row: ProgressRow = {
    itemId,
    status: prev?.status ?? "todo",
    score: prev?.score ?? null,
    note: note.trim() ? note.trim() : null,
    startedAt: prev?.startedAt ?? null,
    doneAt: prev?.doneAt ?? null,
    updatedAt: now(),
  };
  await persist(all, row);
  return row;
}

async function persist(all: Progress, row: ProgressRow): Promise<void> {
  const next: Progress = { ...all, [row.itemId]: row };
  if (isDesktop()) {
    try {
      await desktop().call("learn.set", {
        itemId: row.itemId,
        status: row.status,
        score: row.score,
        note: row.note,
        startedAt: row.startedAt,
        doneAt: row.doneAt,
      });
      return;
    } catch {
      // 桌面端写失败就退回本地，至少别丢
    }
  }
  writeLocal(next);
}

export interface TrackStat {
  track: Track;
  label: string;
  done: number;
  doing: number;
  total: number;
  /** 0~1 */
  ratio: number;
}

export interface Stats {
  total: number;
  done: number;
  doing: number;
  todo: number;
  minutesTotal: number;
  minutesDone: number;
  /** 已完成的条目 id 集合——直接喂给 plan.nextUp / plan.readiness */
  doneIds: Set<string>;
  byTrack: TrackStat[];
  /** 自评过的条目数与平均星数（没人自评时 avg 为 null；不自评不扣分） */
  ratedCount: number;
  ratedAvg: number | null;
}

/** 统计。只统计"做到哪儿了"，不算分、不排名。 */
export function computeStats(progress: Progress): Stats {
  const doneIds = new Set<string>();
  let doing = 0;
  let minutesDone = 0;
  let ratedSum = 0;
  let ratedCount = 0;

  for (const item of ITEMS) {
    const row = progress[item.id];
    if (row?.status === "done") {
      doneIds.add(item.id);
      minutesDone += item.minutes;
    } else if (row?.status === "doing") {
      doing++;
    }
    if (row && row.score != null) {
      ratedSum += row.score;
      ratedCount++;
    }
  }

  const byTrack: TrackStat[] = TRACKS.map(({ id }) => {
    const items = ITEMS.filter((i) => i.track === id);
    const d = items.filter((i) => doneIds.has(i.id)).length;
    const g = items.filter((i) => progress[i.id]?.status === "doing").length;
    return {
      track: id,
      label: TRACK_LABELS[id],
      done: d,
      doing: g,
      total: items.length,
      ratio: items.length ? d / items.length : 0,
    };
  });

  return {
    total: ITEMS.length,
    done: doneIds.size,
    doing,
    todo: ITEMS.length - doneIds.size - doing,
    minutesTotal: ITEMS.reduce((s, i) => s + i.minutes, 0),
    minutesDone,
    doneIds,
    byTrack,
    ratedCount,
    ratedAvg: ratedCount ? Math.round((ratedSum / ratedCount) * 10) / 10 : null,
  };
}
