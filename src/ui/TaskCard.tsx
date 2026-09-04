// 看板卡片：DESIGN-workbench-v2.md §3.2/§3.3 的折叠态六要素卡 + 就地展开四段详情。
// 本文件同时导出几个 BoardView.tsx / DayClose.tsx / TaskEditor.tsx 共用的小工具函数——
// 这几个文件之外不许再建文件，所以把「工作日估算 / 复制剪贴板 / 业务日格式化 / band 视觉映射」放在这里，谁用谁 import。
import { useState } from "preact/hooks";
import type { BoardTask, Band, EditableFields, TaskStep, U8PathRef } from "../board/types";
import { BANDS } from "../board/types";
import { Icon, type IconName, type IconProps } from "./icons";

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
 * 界面这里只需要一个「大致还剩几天」的展示值。
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

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** 三档的图标与语气色——P0~P3 四色分级已经砍掉（DESIGN §4 砍掉清单第1项），卡片左侧色条改用 band 染色。 */
export const BAND_ICON: Record<Band, IconName> = { urgent: "alert", follow: "clock", notice: "info" };
export const BAND_TONE: Record<Band, NonNullable<IconProps["tone"]>> = { urgent: "danger", follow: "warn", notice: "muted" };
export const BAND_NAME: Record<Band, string> = Object.fromEntries(BANDS.map((b) => [b.id, b.name])) as Record<Band, string>;

/** 关键数字的标签：按泳道给一个业务上说得通的名字，不是万能的"数量"。算不出（undefined）的那一格直接不渲染。 */
const QTY_LABEL: Record<BoardTask["stage"], string> = {
  demand: "涉及数量",
  to_order: "下单数量",
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

/** 从 `escalation`（"...开口第一句：「...」"）里抠出开口第一句，折叠态非 U8 动作时当预览行用。 */
function openingLineOf(task: BoardTask): string | undefined {
  const s = task.escalation;
  if (!s) return undefined;
  const m = s.match(/开口第一句[：:]\s*(.+)$/s);
  const line = (m ? m[1] : s).trim();
  return line.replace(/^[「"]/, "").replace(/[」"]$/, "");
}

/** 步骤里的强制闸门：DESIGN §3.2/§3.3——不勾完，主操作按钮点不动。折叠态与展开态复用同一份渲染。 */
function GateSteps({ steps, doneSteps, onToggleStep }: { steps: TaskStep[]; doneSteps: string[]; onToggleStep: (stepId: string, done: boolean) => void }) {
  if (steps.length === 0) return null;
  return (
    <div class="task-gates">
      {steps.map((s) => {
        const checked = doneSteps.includes(s.id);
        return (
          <div class="task-gate" key={s.id}>
            <label>
              <input type="checkbox" checked={checked} onChange={(e) => onToggleStep(s.id, (e.target as HTMLInputElement).checked)} />
              <span class={checked ? "is-checked" : ""}>{s.text}</span>
            </label>
            {s.choices && s.choices.length > 0 && (
              <ul class="task-gate-choices">
                {s.choices.map((c) => (
                  <li key={c.id}><b>{c.text}</b> —— {c.consequence}</li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** U8 指引三态三形（DESIGN §4.1）：verified 给路径+看图文；unverified 给路径+待核对徽章（点开可就地确认/改正）；
 * unknown 完全不印路径，改印「找谁问 + 开口第一句」+复制按钮——印一条错路径比不印更坏。 */
function U8PathBar({
  path, tutorialId, onOpenTutorial, onEdit, onAddEvent,
}: {
  path: U8PathRef;
  tutorialId?: string;
  onOpenTutorial: (tutorialId: string) => void;
  onEdit: (patch: Partial<EditableFields>) => void;
  onAddEvent: (ev: { channel: "系统"; content: string }) => void;
}) {
  const [confirming, setConfirming] = useState(false);

  if (path.confidence === "unknown") {
    return (
      <div class="task-u8bar task-u8bar-unknown">
        <Icon name="warning" size={14} tone="warn" />
        <div class="task-u8bar-body">
          <p class="task-u8bar-line">这一步在 U8 哪儿做我还没核实过。</p>
          {path.askScript && <p class="task-u8bar-script">{path.askScript}</p>}
        </div>
        {path.askScript && (
          <div class="task-u8bar-actions" onClick={(e) => e.stopPropagation()}>
            <CopyButton text={path.askScript} label="复制这句" />
          </div>
        )}
      </div>
    );
  }

  return (
    <div class={`task-u8bar ${path.confidence === "unverified" ? "task-u8bar-unverified" : "task-u8bar-verified"}`}>
      <Icon name="folder" size={14} tone="muted" />
      <span class="task-u8bar-path">{path.path}</span>
      {path.confidence === "unverified" && (
        <button class="task-u8bar-badge" onClick={(e) => { e.stopPropagation(); setConfirming((v) => !v); }}>
          <Icon name="warning" size={12} tone="warn" /> 待你核对
        </button>
      )}
      {path.confidence === "verified" && tutorialId && (
        <button class="btn-link task-u8bar-link" onClick={(e) => { e.stopPropagation(); onOpenTutorial(tutorialId); }}>看图文 ›</button>
      )}
      {confirming && (
        <div class="task-u8bar-confirm" onClick={(e) => e.stopPropagation()}>
          <span>这条路径对吗？</span>
          <button
            class="btn btn-sm"
            onClick={() => {
              onAddEvent({ channel: "系统", content: `核对 U8 路径：「${path.path}」正确` });
              onEdit({ note: `已核对 U8 路径正确：${path.path}` });
              setConfirming(false);
            }}
          >对，就是它</button>
          <button
            class="btn btn-sm"
            onClick={() => {
              const fix = window.prompt("这一步实际在 U8 哪里？", path.path);
              if (fix && fix.trim()) {
                onAddEvent({ channel: "系统", content: `核对 U8 路径：原标注「${path.path}」有误，应为「${fix.trim()}」` });
                onEdit({ note: `U8 路径已改：${fix.trim()}` });
              }
              setConfirming(false);
            }}
          >不对，我改</button>
        </div>
      )}
    </div>
  );
}

const EVENT_CHANNELS = ["电话", "微信", "邮件", "当面", "系统"] as const;

/** 记一笔：跟进记录的录入表单，展开态「跟进记录」段落用。 */
function AddEventForm({ onAdd }: { onAdd: (ev: { channel: string; counterpart?: string; content: string; newPromiseDate?: string }) => void }) {
  const [channel, setChannel] = useState<string>("电话");
  const [counterpart, setCounterpart] = useState("");
  const [content, setContent] = useState("");
  const [newPromiseDate, setNewPromiseDate] = useState("");

  const submit = () => {
    if (!content.trim()) return;
    onAdd({ channel, counterpart: counterpart.trim() || undefined, content: content.trim(), newPromiseDate: newPromiseDate || undefined });
    setContent("");
    setNewPromiseDate("");
  };

  return (
    <div class="task-event-form" onClick={(e) => e.stopPropagation()}>
      <div class="task-event-form-row">
        <select class="input" value={channel} onChange={(e) => setChannel((e.target as HTMLSelectElement).value)}>
          {EVENT_CHANNELS.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <input class="input" placeholder="对方" value={counterpart} onInput={(e) => setCounterpart((e.target as HTMLInputElement).value)} />
        <input class="input" type="date" title="新承诺日（如有）" value={newPromiseDate} onInput={(e) => setNewPromiseDate((e.target as HTMLInputElement).value)} />
      </div>
      <div class="task-event-form-row">
        <input class="input task-event-content-input" placeholder="说了什么 / 结论" value={content} onInput={(e) => setContent((e.target as HTMLInputElement).value)} />
        <button class="btn btn-sm btn-primary" disabled={!content.trim()} onClick={submit}>记下</button>
      </div>
    </div>
  );
}

/** 完成凭据小窗（DESIGN §3.2）：primaryAction.evidence 的 1~2 格，必填齐才能提交。evidence 为空数组时一键完成，不弹窗。 */
function EvidenceModal({
  label, fields, onSubmit, onCancel,
}: {
  label: string;
  fields: { key: string; label: string; type: "text" | "date" | "checkbox" | "select"; required: boolean; options?: string[] }[];
  onSubmit: (evidence: Record<string, string>) => void;
  onCancel: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const ready = fields.every((f) => !f.required || (f.type === "checkbox" ? values[f.key] === "1" : (values[f.key] ?? "").trim().length > 0));

  return (
    <div class="evidence-backdrop" onClick={onCancel}>
      <div class="evidence-panel" onClick={(e) => e.stopPropagation()}>
        <p class="evidence-title">填一下就算干完</p>
        {fields.length === 0 && <p class="muted">这一步不需要额外凭据，直接确认完成即可。</p>}
        {fields.map((f) => (
          <div class="evidence-field" key={f.key}>
            {f.type === "checkbox" ? (
              <label class="evidence-checkbox">
                <input type="checkbox" checked={values[f.key] === "1"} onChange={(e) => setValues((v) => ({ ...v, [f.key]: (e.target as HTMLInputElement).checked ? "1" : "" }))} />
                {f.label}{f.required && <span class="evidence-required">*</span>}
              </label>
            ) : f.type === "select" ? (
              <label class="evidence-label">
                {f.label}{f.required && <span class="evidence-required">*</span>}
                <select class="input" value={values[f.key] ?? ""} onChange={(e) => setValues((v) => ({ ...v, [f.key]: (e.target as HTMLSelectElement).value }))}>
                  <option value="">请选择…</option>
                  {(f.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              </label>
            ) : (
              <label class="evidence-label">
                {f.label}{f.required && <span class="evidence-required">*</span>}
                <input class="input" type={f.type} value={values[f.key] ?? ""} onInput={(e) => setValues((v) => ({ ...v, [f.key]: (e.target as HTMLInputElement).value }))} />
              </label>
            )}
          </div>
        ))}
        <div class="evidence-actions">
          <button class="btn" onClick={onCancel}>取消</button>
          <button class="btn btn-primary" disabled={!ready} onClick={() => onSubmit(values)}>完成 ✓</button>
        </div>
      </div>
    </div>
  );
}

interface TaskCardProps {
  task: BoardTask;
  bizDate: string;
  expanded: boolean;
  /** 同一供应商可合并的其它卡标题，非空才显示合并提示。 */
  groupPeers?: string[];
  onToggleExpand: () => void;
  onToggleStep: (stepId: string, done: boolean) => void;
  onComplete: (evidence: Record<string, string>) => void;
  onEdit: (patch: Partial<EditableFields>) => void;
  onAddEvent: (ev: { channel: string; counterpart?: string; content: string; newPromiseDate?: string }) => void;
  onAskAgent: (question: string) => void;
  onOpenTutorial: (tutorialId: string) => void;
  onOpenEditor: () => void;
}

export function TaskCard({
  task, bizDate, expanded, groupPeers,
  onToggleExpand, onToggleStep, onComplete, onEdit, onAddEvent, onAskAgent, onOpenTutorial, onOpenEditor,
}: TaskCardProps) {
  const [showInfo, setShowInfo] = useState(false);
  const [showReasons, setShowReasons] = useState(false);
  const [showEvidence, setShowEvidence] = useState(false);
  const done = task.status === "done";

  const anchors = [
    task.materialCode && task.materialName ? `${task.materialCode} ${task.materialName}` : (task.materialName ?? task.materialCode),
    task.supplier,
    task.poNo ?? (task.stage === "to_order" ? "PO 未开" : undefined),
  ].filter(Boolean) as string[];

  const left = task.dueDate ? workdaysBetween(bizDate, task.dueDate) : undefined;
  let dueText = "";
  let dueCls = "muted";
  if (left !== undefined) {
    if (left < 0) { dueText = `逾期 ${-left} 个工作日`; dueCls = "due-overdue"; }
    else if (left <= 1) { dueText = left === 0 ? "今天必须搞定" : "还剩 1 个工作日"; dueCls = "due-soon"; }
    else { dueText = `还剩 ${left} 个工作日`; }
  }

  const gateSteps = task.steps.filter((s) => s.role === "gate");
  const hintSteps = task.steps.filter((s) => s.role === "hint");
  const gatesOk = gateSteps.every((s) => task.doneSteps.includes(s.id));

  const isU8 = task.primaryAction.actionKind === "u8" && !!task.primaryAction.u8Path;
  const opening = !isU8 ? openingLineOf(task) : undefined;

  const infoLines: string[] = [
    ...task.reasons.slice(0, 1),
    ...(task.sourceRow ? Object.entries(task.sourceRow).map(([k, v]) => `${k}：${v}`) : []),
  ];
  const copyPayload = [task.title, task.qty !== undefined ? `${QTY_LABEL[task.stage]} ${task.qty}` : "", ...infoLines].filter(Boolean).join("\n");

  const handleEdit = (patch: Partial<EditableFields>) => onEdit(patch);
  const handleAddEventSystem = (ev: { channel: "系统"; content: string }) => onAddEvent(ev);

  return (
    <article class={`task-card band-${task.band} ${expanded ? "is-expanded" : ""} ${done ? "is-done" : ""}`}>
      <div
        class="task-card-head"
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        onClick={onToggleExpand}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggleExpand(); } }}
      >
        <span class={`band-pill band-pill-${task.band}`} title={task.bandWhy}>
          <Icon name={BAND_ICON[task.band]} size={13} tone={BAND_TONE[task.band]} /> {BAND_NAME[task.band]}
        </span>
        <h4 class="task-title">{task.title}</h4>
        <span class="task-badge" title="档内排序分（分数不上台面，只用来排序）">{task.score}</span>
        <span class={`task-caret${expanded ? " is-open" : ""}`} title={expanded ? "收起" : "展开"} aria-hidden="true">
          <Icon name="chevronDown" size={15} />
        </span>
      </div>

      {!expanded ? (
        <>
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

          {(task.qty !== undefined || task.coverageDays !== undefined || dueText) && (
            <div class="task-meta">
              {task.qty !== undefined && (
                <span class="task-metric">
                  {QTY_LABEL[task.stage]} <b>{task.qty}</b>
                  <button class="btn-icon-inline" title="算式来源" aria-label="算式来源" onClick={(e) => { e.stopPropagation(); setShowInfo((v) => !v); }}>
                    <Icon name="info" size={14} />
                  </button>
                </span>
              )}
              {task.qty === undefined && task.coverageDays !== undefined && (
                <span class="task-metric">覆盖天数 <b>{task.coverageDays}</b> 天</span>
              )}
              {dueText && <span class={`task-due ${dueCls}`}>最晚动作日 {task.dueDate} · {dueText}</span>}
            </div>
          )}

          {showInfo && (
            <div class="task-info-pop" onClick={(e) => e.stopPropagation()}>
              {infoLines.length > 0 ? infoLines.map((l, i) => <div key={i} class="task-info-line">{l}</div>) : <div class="task-info-line muted">暂无更多来源信息。</div>}
              <CopyButton text={copyPayload} label="复制这条" />
            </div>
          )}

          <GateSteps steps={gateSteps} doneSteps={task.doneSteps} onToggleStep={onToggleStep} />

          {isU8 && task.primaryAction.u8Path && (
            <U8PathBar path={task.primaryAction.u8Path} tutorialId={task.tutorialId} onOpenTutorial={onOpenTutorial} onEdit={handleEdit} onAddEvent={handleAddEventSystem} />
          )}
          {!isU8 && opening && <p class="task-opening-preview">「{opening.length > 60 ? `${opening.slice(0, 60)}…` : opening}」</p>}
        </>
      ) : (
        <div class="task-detail" onClick={(e) => e.stopPropagation()}>
          <div class="task-detail-toolbar">
            <button class="btn-link" onClick={onOpenEditor}>编辑可写字段 ›</button>
          </div>

          <section class="task-detail-sec">
            <h5>为什么是这一档</h5>
            <p class="task-band-why">
              <Icon name={BAND_ICON[task.band]} size={13} tone={BAND_TONE[task.band]} /> {BAND_NAME[task.band]} · 规则 {task.bandRule}：{task.bandWhy}
            </p>
            {task.reasons.length > 0 && (
              <>
                <button class="btn-link" onClick={() => setShowReasons((v) => !v)}>{showReasons ? "收起" : "展开"}排序依据（{task.score} 分）</button>
                {showReasons && <ul class="task-reasons">{task.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>}
              </>
            )}
          </section>

          <section class="task-detail-sec">
            <h5>必须先做（不勾完下面的按钮点不动）</h5>
            {gateSteps.length > 0
              ? <GateSteps steps={gateSteps} doneSteps={task.doneSteps} onToggleStep={onToggleStep} />
              : <p class="muted">这张卡没有强制步骤。</p>}
          </section>

          {hintSteps.length > 0 && (
            <section class="task-detail-sec">
              <h5>做法参考（不用勾）</h5>
              <ul class="task-hints">
                {hintSteps.map((s) => (
                  <li key={s.id}>
                    {s.text}{s.where && <span class="task-step-where">（{s.where}）</span>}
                    {s.u8Path && s.u8Path.confidence !== "unknown" && (
                      <div class="task-hint-path">
                        <Icon name="folder" size={12} tone="muted" /> {s.u8Path.path}
                        {s.u8Path.confidence === "unverified" && <span class="task-hint-warn"> ⚠ 待你核对</span>}
                      </div>
                    )}
                  </li>
                ))}
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

          <section class="task-detail-sec">
            <h5>跟进记录</h5>
            {task.events.length > 0 ? (
              <ul class="task-events">
                {[...task.events].sort((a, b) => (a.at < b.at ? 1 : -1)).map((ev) => (
                  <li key={ev.id}>
                    <span class="task-event-meta">{ev.at} · {ev.channel}{ev.counterpart ? ` · ${ev.counterpart}` : ""}</span>
                    <span class="task-event-content">{ev.content}</span>
                    {ev.newPromiseDate && <span class="task-event-promise">新承诺日 {ev.newPromiseDate}</span>}
                  </li>
                ))}
              </ul>
            ) : <p class="muted">还没有跟进记录。</p>}
            <AddEventForm onAdd={onAddEvent} />
          </section>
        </div>
      )}

      {task.doneRule && <div class="task-donerule">完成标志：{task.doneRule}</div>}

      <div class="task-actions" onClick={(e) => e.stopPropagation()}>
        <button
          class="btn btn-sm btn-primary"
          disabled={done || !gatesOk}
          title={!gatesOk ? "先勾完上面的步骤才能点" : undefined}
          onClick={() => {
            if (task.primaryAction.evidence.length === 0) onComplete({});
            else setShowEvidence(true);
          }}
        >
          <Icon name="check" size={14} /> {done ? "已完成" : task.primaryAction.label}
        </button>
        <button class="btn btn-sm" onClick={() => onAskAgent(`关于「${task.title}」，我该怎么处理？`)}>问采姐</button>
      </div>

      {showEvidence && (
        <EvidenceModal
          label={task.primaryAction.label}
          fields={task.primaryAction.evidence}
          onCancel={() => setShowEvidence(false)}
          onSubmit={(evidence) => { onComplete(evidence); setShowEvidence(false); }}
        />
      )}
    </article>
  );
}
