// 看板卡片：苏姐规格 §3.3/§3.4 的六要素卡 + 就地展开四段详情。
// 本文件同时导出几个 BoardView.tsx / DayClose.tsx 共用的小工具函数——三个文件之外不许再建文件，
// 所以把「工作日估算 / 复制剪贴板 / 业务日格式化 / 分数分级」这些纯函数放在这里，谁用谁 import。
import { useState } from "preact/hooks";
import type { BoardTask, Stage } from "../board/types";
import { Icon } from "./icons";

/** 中文星期，业务日格式化用，不额外拉 date-fns 的 locale 子包。 */
const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
export function formatBizDate(bizDate: string): string {
  const d = new Date(`${bizDate}T00:00:00`);
  if (Number.isNaN(d.getTime())) return bizDate;
  return `${bizDate} ${WEEKDAYS[d.getDay()]}`;
}

/**
 * 简化版工作日估算：只排除周六日，不含法定节假日/调休。
 * 完整口径（含调休日历）属于打分引擎 `board/calendar.ts` 的职责，那是另一位工兵的活；
 * 界面这里只需要一个「大致还剩几天」的展示值，逾期/紧迫的红橙判定不受这点误差影响。
 */
export function workdaysBetween(fromStr: string, toStr: string): number {
  const from = new Date(`${fromStr}T00:00:00`);
  const to = new Date(`${toStr}T00:00:00`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return 0;
  const sign = to.getTime() >= from.getTime() ? 1 : -1;
  const [a, b] = sign > 0 ? [from, to] : [to, from];
  let count = 0;
  const cur = new Date(a);
  while (cur.getTime() < b.getTime()) {
    cur.setDate(cur.getDate() + 1);
    const day = cur.getDay();
    if (day !== 0 && day !== 6) count++;
  }
  return count * sign;
}

/** 分数 → 四色分级。BoardTask 只落了 score，没有落 ScoreBreakdown.level，分级阈值参照苏姐 §4 示例反推。
 * 不再用彩色圆点表情——分级颜色改由 BoardView.css 里 `.task-card.tier-*` 染左侧色条 + 分数徽章表达。 */
export function tierOf(score: number): { cls: string } {
  if (score >= 100) return { cls: "tier-red" };
  if (score >= 70) return { cls: "tier-orange" };
  if (score >= 40) return { cls: "tier-yellow" };
  return { cls: "tier-green" };
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** 关键数字的标签：按泳道给一个业务上说得通的名字，不是万能的"数量"。 */
const QTY_LABEL: Record<Stage, string> = {
  order: "净缺口",
  confirm: "下单数量",
  transit: "在途数量",
  inbound: "到货数量",
};

/** 小按钮：点一下复制，短暂反馈「已复制」再变回去。 */
function CopyButton({ text, label = "复制" }: { text: string; label?: string }) {
  const [ok, setOk] = useState(false);
  const onClick = async (e: MouseEvent) => {
    e.stopPropagation();
    if (await copyText(text)) {
      setOk(true);
      setTimeout(() => setOk(false), 1500);
    }
  };
  return (
    <button class="btn btn-sm" onClick={onClick}>
      {ok ? "已复制" : label}
    </button>
  );
}

interface TaskCardProps {
  task: BoardTask;
  bizDate: string;
  expanded: boolean;
  /** 苏姐铁律②的一部分：同供应商可合并的其它卡标题，非空才显示合并提示。 */
  groupPeers?: string[];
  /** 今天三件事横幅里用更醒目的版式；泳道里用常规版式。 */
  variant?: "top3" | "lane";
  onToggleExpand: () => void;
  onToggleStep: (stepId: string, done: boolean) => void;
  onStatus: (status: BoardTask["status"], note?: string) => void;
  onAskAgent: (question: string) => void;
}

export function TaskCard({ task, bizDate, expanded, groupPeers, variant = "lane", onToggleExpand, onToggleStep, onStatus, onAskAgent }: TaskCardProps) {
  const [showInfo, setShowInfo] = useState(false);
  const tier = tierOf(task.score);
  const done = task.status === "done";

  const anchors = [
    task.materialCode && task.materialName ? `${task.materialCode} ${task.materialName}` : task.materialName ?? task.materialCode,
    task.supplier,
    task.poNo,
  ].filter(Boolean) as string[];

  const left = task.dueDate ? workdaysBetween(bizDate, task.dueDate) : undefined;
  let dueText = "";
  let dueCls = "muted";
  if (left !== undefined) {
    if (left < 0) {
      dueText = `逾期 ${-left} 个工作日`;
      dueCls = "due-overdue";
    } else if (left <= 1) {
      dueText = left === 0 ? "今天必须搞定" : "还剩 1 个工作日";
      dueCls = "due-soon";
    } else {
      dueText = `还剩 ${left} 个工作日`;
    }
  }

  const infoLines: string[] = [
    ...task.reasons.slice(0, 1),
    ...(task.sourceRow ? Object.entries(task.sourceRow).map(([k, v]) => `${k}：${v}`) : []),
  ];
  const copyPayload = [
    `${task.title}`,
    task.qty !== undefined ? `${QTY_LABEL[task.stage]} ${task.qty}` : "",
    ...infoLines,
  ].filter(Boolean).join("\n");

  return (
    <article class={`task-card ${tier.cls} ${variant === "top3" ? "task-card-top3" : ""} ${expanded ? "is-expanded" : ""} ${done ? "is-done" : ""}`}>
      <div
        class="task-card-head"
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        onClick={onToggleExpand}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggleExpand(); } }}
      >
        <span class="task-badge">{task.score}</span>
        <h4 class="task-title">{task.title}</h4>
        <span class={`task-caret${expanded ? " is-open" : ""}`} title={expanded ? "收起" : "展开"} aria-hidden="true">
          <Icon name="chevronDown" size={15} />
        </span>
      </div>

      {(anchors.length > 0 || groupPeers?.length) && (
        <div class="task-anchors">
          {anchors.map((a, i) => <span key={i} class="task-anchor">{a}</span>)}
          {!!groupPeers?.length && (
            <span class="task-anchor task-group-badge" title={`同一供应商，可一次沟通处理：${groupPeers.join("、")}`}>
              <Icon name="link" size={12} /> 可与 {groupPeers.length} 张单合并处理
            </span>
          )}
        </div>
      )}

      {(task.qty !== undefined || dueText) && (
        <div class="task-meta">
          {task.qty !== undefined && (
            <span class="task-metric">
              {QTY_LABEL[task.stage]} <b>{task.qty}</b>
              <button class="btn-icon-inline" title="算式来源" aria-label="算式来源" onClick={(e) => { e.stopPropagation(); setShowInfo((v) => !v); }}>
                <Icon name="info" size={14} />
              </button>
            </span>
          )}
          {dueText && <span class={`task-due ${dueCls}`}>{task.dueDate} · {dueText}</span>}
        </div>
      )}

      {showInfo && (
        <div class="task-info-pop" onClick={(e) => e.stopPropagation()}>
          {infoLines.length > 0 ? infoLines.map((l, i) => <div key={i} class="task-info-line">{l}</div>) : <div class="task-info-line muted">暂无更多来源信息。</div>}
          <CopyButton text={copyPayload} label="复制这条" />
        </div>
      )}

      {task.doneRule && <div class="task-donerule">完成标志：{task.doneRule}</div>}

      <div class="task-actions" onClick={(e) => e.stopPropagation()}>
        <button class="btn btn-sm" onClick={onToggleExpand}>怎么做</button>
        <button class="btn btn-sm" onClick={() => onAskAgent(`关于「${task.title}」，我该怎么处理？`)}>问采姐</button>
        <button class="btn btn-sm btn-primary" disabled={done} onClick={() => onStatus("done")}>
          <Icon name="check" size={14} /> {done ? "已完成" : "干完了"}
        </button>
      </div>

      {expanded && (
        <div class="task-detail" onClick={(e) => e.stopPropagation()}>
          {task.reasons.length > 0 && (
            <section class="task-detail-sec">
              <h5>为什么是它排第一</h5>
              <ul>{task.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
            </section>
          )}

          {task.steps.length > 0 && (
            <section class="task-detail-sec">
              <h5>三步（勾完自动完成）</h5>
              <ul class="task-steps">
                {task.steps.map((s) => {
                  const checked = task.doneSteps.includes(s.id);
                  return (
                    <li key={s.id}>
                      <label>
                        <input type="checkbox" checked={checked} onChange={(e) => onToggleStep(s.id, (e.target as HTMLInputElement).checked)} />
                        <span class={checked ? "is-checked" : ""}>{s.text}</span>
                        {s.where && <span class="task-step-where">（{s.where}）</span>}
                      </label>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {task.escalation && (
            <section class="task-detail-sec">
              <h5>卡住了找谁 · 开口第一句</h5>
              <p class="task-escalation">{task.escalation}</p>
              <CopyButton text={task.escalation} label="复制" />
            </section>
          )}
        </div>
      )}
    </article>
  );
}
