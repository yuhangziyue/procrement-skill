// 交期倒推（order-checklist §B 的程序化版本）。
// 最晚下单日 = 目标到货日 − 运输 − 生产周期(按口径) − 接单截止修正 − 安全缓冲。每一步都进 timeline，方便贴进 PO 备注留痕。
import { addDays, compareTime, fmtCn, isHoliday, isWorkday, longHolidayBetween, parseDate, weekday, type CalendarOptions, fmt } from "./calendar";

export type ProductionCalendar = "natural" | "skip_sunday" | "workdays";

export interface ScheduleInput {
  /** 车间需求日期 YYYY-MM-DD */
  needDate: string;
  /** 今天，默认取系统日期 */
  today?: string;
  /** 现在时刻 HH:mm，用于接单截止判断 */
  nowTime?: string;
  /** 目标到货比需求日提前几天，默认 1 */
  arrivalBufferDays?: number;
  transportDays: number;
  productionDays: number;
  /** 生产周期口径：自然日 / 周日不生产 / 只算工作日。默认自然日 */
  productionCalendar?: ProductionCalendar;
  /** 新品打样天数（首单加） */
  sampleDays?: number;
  /** 接单截止时刻 HH:mm，如 16:00 */
  orderCutoff?: string;
  /** 固定发车日（0=周日…6=周六），空=天天发 */
  shipWeekdays?: number[];
  /** 仓库可收货的星期，默认周一至周五 */
  receivingWeekdays?: number[];
  /** 仓库收货截止时刻 HH:mm */
  receivingUntil?: string;
  /** 供应商货一般几点到 HH:mm */
  supplierArrivalTime?: string;
  /** 供应商准交表现：normal 缓冲 +1；poor 缓冲 +2 */
  onTimeGrade?: "normal" | "poor";
  /** 雨季 / 大促季再 +1 */
  season?: "normal" | "peak";
  /** 供应商停产期 */
  supplierShutdown?: { from: string; to: string }[];
  /** 加急生产天数（来不及时给备选） */
  expediteProductionDays?: number;
  calendar?: CalendarOptions;
}

export interface TimelineStep {
  label: string;
  date: string;
  note?: string;
}

export interface ScheduleResult {
  ok: boolean;
  latestOrderDate: string;
  targetArrivalDate: string;
  shipDate: string;
  productionStartDate: string;
  bufferDays: number;
  timeline: TimelineStep[];
  flags: string[];
  /** 来不及时的两条路 */
  alternatives?: { expedite?: { latestOrderDate: string; note: string }; earliestArrival: { date: string; note: string } };
  formula: string;
}

function inShutdown(d: Date, ranges: { from: string; to: string }[] = []) {
  const s = fmt(d);
  return ranges.some((r) => s >= r.from && s <= r.to);
}

/** 生产日是否可用（按口径） */
function isProductionDay(d: Date, cal: ProductionCalendar, opt: CalendarOptions, shutdown: ScheduleInput["supplierShutdown"]) {
  if (inShutdown(d, shutdown)) return false;
  if (cal === "natural") return true;
  if (cal === "skip_sunday") return weekday(d) !== 0;
  return isWorkday(d, opt);
}

/** 从 done 往前数 n 个生产日，返回开工日（接单日） */
function backProductionDays(done: Date, n: number, cal: ProductionCalendar, opt: CalendarOptions, shutdown: ScheduleInput["supplierShutdown"]) {
  let d = done;
  let counted = 0;
  let guard = 0;
  while (counted < n && guard++ < 400) {
    d = addDays(d, -1);
    if (isProductionDay(d, cal, opt, shutdown)) counted++;
  }
  return d;
}
function forwardProductionDays(start: Date, n: number, cal: ProductionCalendar, opt: CalendarOptions, shutdown: ScheduleInput["supplierShutdown"]) {
  let d = start;
  let counted = 0;
  let guard = 0;
  while (counted < n && guard++ < 400) {
    if (isProductionDay(d, cal, opt, shutdown)) counted++;
    if (counted < n) d = addDays(d, 1);
  }
  return d;
}

export function backwardSchedule(input: ScheduleInput): ScheduleResult {
  const opt = input.calendar ?? {};
  const cal = input.productionCalendar ?? "natural";
  const recvDays = input.receivingWeekdays ?? [1, 2, 3, 4, 5];
  const today = input.today ? parseDate(input.today) : parseDate(new Date().toISOString().slice(0, 10));
  const timeline: TimelineStep[] = [];
  const flags: string[] = [];

  // 1. 目标到货日：需求日 − 缓冲，且必须是可收货的工作日
  const need = parseDate(input.needDate);
  let target = addDays(need, -(input.arrivalBufferDays ?? 1));
  const canReceive = (d: Date) => recvDays.includes(weekday(d)) && !isHoliday(d, opt);
  let moved = false;
  while (!canReceive(target)) {
    target = addDays(target, -1);
    moved = true;
  }
  if (moved) flags.push(`目标到货日落在非收货日/节假日，已提前到 ${fmtCn(target)}`);
  if (input.supplierArrivalTime && input.receivingUntil && compareTime(input.supplierArrivalTime, input.receivingUntil) > 0) {
    target = addDays(target, -1);
    while (!canReceive(target)) target = addDays(target, -1);
    flags.push(`供应商一般 ${input.supplierArrivalTime} 到，晚于仓库收货截止 ${input.receivingUntil}，再提前一天到 ${fmtCn(target)}`);
  }
  timeline.push({ label: "车间需求日", date: fmtCn(need) });
  timeline.push({ label: "目标到货日", date: fmtCn(target), note: `需求日 − ${input.arrivalBufferDays ?? 1} 天缓冲，对齐收货日` });

  // 2. 发货日：目标到货 − 运输，对齐发车日
  let ship = addDays(target, -input.transportDays);
  if (input.shipWeekdays && input.shipWeekdays.length) {
    let aligned = false;
    while (!input.shipWeekdays.includes(weekday(ship)) || isHoliday(ship, opt)) {
      ship = addDays(ship, -1);
      aligned = true;
    }
    if (aligned) flags.push(`供应商固定 ${input.shipWeekdays.map((w) => ["日", "一", "二", "三", "四", "五", "六"][w]).join("/")} 发车，发货日对齐到 ${fmtCn(ship)}`);
  }
  timeline.push({ label: "最晚发货日", date: fmtCn(ship), note: `目标到货 − 运输 ${input.transportDays} 天` });

  // 3. 生产：发货日前完成；按口径往前数生产天数（+ 打样）
  const productionStart = backProductionDays(ship, input.productionDays + (input.sampleDays ?? 0), cal, opt, input.supplierShutdown);
  const calNote = { natural: "自然日", skip_sunday: "周日不生产", workdays: "只算工作日" }[cal];
  timeline.push({
    label: "最晚接单/开工日",
    date: fmtCn(productionStart),
    note: `生产 ${input.productionDays} 天（${calNote}）${input.sampleDays ? ` + 打样 ${input.sampleDays} 天` : ""}`,
  });
  if (input.supplierShutdown?.length) flags.push("已跳过供应商停产期");

  // 4. 缓冲：常规 1 / 准交差 2 / 旺季再 +1
  let buffer = input.onTimeGrade === "poor" ? 2 : 1;
  if (input.season === "peak") buffer += 1;
  let latest = addDays(productionStart, -buffer);
  timeline.push({ label: "最晚下单日", date: fmtCn(latest), note: `接单日 − 安全缓冲 ${buffer} 天` });

  // 5. 接单截止修正：今天就是最晚下单日且已过截止 ⇒ 来不及
  let ok = fmt(latest) >= fmt(today);
  if (ok && fmt(latest) === fmt(today) && input.orderCutoff && input.nowTime && compareTime(input.nowTime, input.orderCutoff) > 0) {
    ok = false;
    flags.push(`今天 ${input.nowTime} 已过供应商接单截止 ${input.orderCutoff}，按次日接单算，常规交期来不及`);
  }

  // 6. 横跨长假
  const lh = longHolidayBetween(latest, target);
  if (lh) flags.push(`排期横跨${lh}，供应商通常提前停接单，整体再前置并电话确认`);

  const formula = `最晚下单日 = 目标到货 ${fmt(target)} − 运输 ${input.transportDays} 天 → 发货 ${fmt(ship)} − 生产 ${input.productionDays}${input.sampleDays ? `+打样${input.sampleDays}` : ""} 天(${calNote}) → 接单 ${fmt(productionStart)} − 缓冲 ${buffer} 天 = ${fmt(latest)}`;

  const result: ScheduleResult = {
    ok,
    latestOrderDate: fmt(latest),
    targetArrivalDate: fmt(target),
    shipDate: fmt(ship),
    productionStartDate: fmt(productionStart),
    bufferDays: buffer,
    timeline,
    flags,
    formula,
  };

  if (!ok) {
    // 备选 A：加急
    let expedite: { latestOrderDate: string; note: string } | undefined;
    if (input.expediteProductionDays) {
      const eStart = backProductionDays(ship, input.expediteProductionDays, cal, opt, input.supplierShutdown);
      const eLatest = addDays(eStart, -1);
      expedite = {
        latestOrderDate: fmt(eLatest),
        note: fmt(eLatest) >= fmt(today) ? `加急生产 ${input.expediteProductionDays} 天可赶上，最晚 ${fmtCn(eLatest)} 下单（加急费先请示）` : "加急也来不及",
      };
    }
    // 备选 B：今天下单最早哪天到
    let accept = today;
    if (input.orderCutoff && input.nowTime && compareTime(input.nowTime, input.orderCutoff) > 0) accept = addDays(today, 1);
    while (!isProductionDay(accept, cal, opt, input.supplierShutdown)) accept = addDays(accept, 1);
    let done = forwardProductionDays(accept, input.productionDays + (input.sampleDays ?? 0), cal, opt, input.supplierShutdown);
    let eShip = done;
    if (input.shipWeekdays && input.shipWeekdays.length) while (!input.shipWeekdays.includes(weekday(eShip)) || isHoliday(eShip, opt)) eShip = addDays(eShip, 1);
    let arrive = addDays(eShip, input.transportDays);
    while (!canReceive(arrive)) arrive = addDays(arrive, 1);
    result.alternatives = {
      expedite,
      earliestArrival: { date: fmt(arrive), note: `今天下单按常规周期最早 ${fmtCn(arrive)} 到，比需求日晚 ${Math.round((arrive.getTime() - need.getTime()) / 86400000) + (input.arrivalBufferDays ?? 1)} 天左右，需与生产确认能否调计划` },
    };
  }
  return result;
}
