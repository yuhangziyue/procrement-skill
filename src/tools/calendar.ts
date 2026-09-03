// 日期工具 + 2026 年法定节假日（国办发明电〔2025〕7 号，2025-11-04 发布）。
// 节假日/调休表可在设置页追加；供应商自己的停产期由 backward_schedule 的参数传入。

export const HOLIDAYS_2026: string[] = [
  "2026-01-01", "2026-01-02", "2026-01-03",
  "2026-02-15", "2026-02-16", "2026-02-17", "2026-02-18", "2026-02-19", "2026-02-20", "2026-02-21", "2026-02-22", "2026-02-23",
  "2026-04-04", "2026-04-05", "2026-04-06",
  "2026-05-01", "2026-05-02", "2026-05-03", "2026-05-04", "2026-05-05",
  "2026-06-19", "2026-06-20", "2026-06-21",
  "2026-09-25", "2026-09-26", "2026-09-27",
  "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07",
];
/** 调休上班的周末 */
export const WORKDAY_ADJUST_2026: string[] = ["2026-01-04", "2026-02-14", "2026-02-28", "2026-05-09", "2026-09-20", "2026-10-10"];
/** 长假（横跨时要整体前置） */
export const LONG_HOLIDAYS_2026: { name: string; from: string; to: string }[] = [
  { name: "春节", from: "2026-02-15", to: "2026-02-23" },
  { name: "国庆", from: "2026-10-01", to: "2026-10-07" },
];

export interface CalendarOptions {
  extraHolidays?: string[];
  extraWorkdays?: string[];
}

export function parseDate(s: string): Date {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s.trim());
  if (!m) throw new Error(`日期格式应为 YYYY-MM-DD，收到「${s}」`);
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12));
}
export function fmt(d: Date): string {
  return d.toISOString().slice(0, 10);
}
export function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setUTCDate(r.getUTCDate() + n);
  return r;
}
/** 0=周日 … 6=周六 */
export const weekday = (d: Date) => d.getUTCDay();
export const WEEKDAY_CN = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
export const fmtCn = (d: Date) => `${fmt(d)}（${WEEKDAY_CN[weekday(d)]}）`;

export function isHoliday(d: Date, opt: CalendarOptions = {}): boolean {
  const s = fmt(d);
  return HOLIDAYS_2026.includes(s) || (opt.extraHolidays ?? []).includes(s);
}
export function isAdjustedWorkday(d: Date, opt: CalendarOptions = {}): boolean {
  const s = fmt(d);
  return WORKDAY_ADJUST_2026.includes(s) || (opt.extraWorkdays ?? []).includes(s);
}
/** 法定工作日：非节假日，且（周一至周五 或 调休上班日） */
export function isWorkday(d: Date, opt: CalendarOptions = {}): boolean {
  if (isHoliday(d, opt)) return false;
  const w = weekday(d);
  return (w >= 1 && w <= 5) || isAdjustedWorkday(d, opt);
}
export function compareTime(a: string, b: string): number {
  const [ah, am] = a.split(":").map(Number);
  const [bh, bm] = b.split(":").map(Number);
  return ah * 60 + am - (bh * 60 + bm);
}
export function longHolidayBetween(from: Date, to: Date): string | undefined {
  const f = fmt(from), t = fmt(to);
  return LONG_HOLIDAYS_2026.find((h) => !(h.to < f || h.from > t))?.name;
}
