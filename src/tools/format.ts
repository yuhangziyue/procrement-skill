// 工具结果 → 给模型和 UI 看的 markdown。算式原样输出，方便贴进 PO 备注留痕。
import type { CalcResult } from "./calc-order-qty";
import type { ScheduleResult } from "./backward-schedule";

export function formatCalc(r: CalcResult): string {
  const lines: string[] = [r.headline, ""];
  if (r.steps.length) {
    lines.push("**算式（可贴进 PO 备注）**");
    r.steps.forEach((s) => lines.push(`- ${s}`));
    lines.push("");
  }
  if (r.moqOptions) {
    lines.push("**MOQ 三选一（你定）**");
    r.moqOptions.forEach((o) => lines.push(`- ${o}`));
    lines.push("");
  }
  if (r.flags.length) {
    lines.push("**注意**");
    r.flags.forEach((f) => lines.push(`- ⚠️ ${f}`));
  }
  return lines.join("\n").trim();
}

export function formatSchedule(r: ScheduleResult): string {
  const lines: string[] = [];
  lines.push(r.ok ? `✅ **最晚下单日：${r.latestOrderDate}**（常规交期来得及）` : `🔴 **常规交期来不及**（最晚下单日 ${r.latestOrderDate} 已过）`);
  lines.push("");
  lines.push("| 节点 | 日期 | 说明 |", "|---|---|---|");
  r.timeline.forEach((t) => lines.push(`| ${t.label} | ${t.date} | ${t.note ?? ""} |`));
  lines.push("", `算式：${r.formula}`);
  if (r.flags.length) {
    lines.push("", "**注意**");
    r.flags.forEach((f) => lines.push(`- ⚠️ ${f}`));
  }
  if (!r.ok && r.alternatives) {
    lines.push("", "**两条路（别下一张注定迟到的单）**");
    if (r.alternatives.expedite) lines.push(`- 加急：${r.alternatives.expedite.note}`);
    lines.push(`- 改计划：${r.alternatives.earliestArrival.note}`);
  }
  return lines.join("\n");
}
