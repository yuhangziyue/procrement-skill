// 可写字段编辑面板（DESIGN-workbench-v2.md §3.1 ②③ + §3.4）。
// 只开放判断层与过程层：note / materialCodeFix / supplierOverride / promiseDate+promiseSource /
// etaDate / trackingNo / nextActionAt / blockedBy / escalatedTo。事实层（货码/数量/需求日等）永远只读，
// 只读字段旁边不给输入框——本文件里事实值只出现在「冲突对照」的静态展示行里。
// 冲突呈现用规格定的唯一样式：事实值在上不动，判断值缩进一行 + 时间戳/来源；[用这个] 只回调（转给 onAskAgent
// 请采姐去改数据源），不直接写 editable 之外的任何东西——小采永不替她改 U8，也永不替她改数据源。
import { useState } from "preact/hooks";
import type { BoardTask, EditableFields } from "../board/types";
import { Icon } from "./icons";
import "./TaskEditor.css";

export interface TaskEditorProps {
  task: BoardTask;
  onSave: (patch: Partial<EditableFields>) => void;
  onAskAgent: (question: string) => void;
  onClose: () => void;
}

const BLOCKED_LABEL: Record<NonNullable<EditableFields["blockedBy"]>, string> = {
  none: "没卡在谁那里",
  warehouse: "仓库",
  finance: "财务",
  production: "生产",
  supplier: "供应商",
};
const PROMISE_SOURCE_LABEL: Record<NonNullable<EditableFields["promiseSource"]>, string> = {
  signback: "书面回签",
  verbal: "口头",
  guess: "我猜的",
};

function fmtStamp(ts: number): string {
  if (!ts) return "";
  const d = new Date(ts);
  return `${d.getMonth() + 1}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function TaskEditor({ task, onSave, onAskAgent, onClose }: TaskEditorProps) {
  const [form, setForm] = useState<EditableFields>({ ...task.editable });
  const set = <K extends keyof EditableFields>(k: K, v: EditableFields[K]) => setForm((f) => ({ ...f, [k]: v }));

  const useThis = (label: string, value: string) => {
    onAskAgent(`确认${label}用「${value}」——麻烦登记一张核对卡去改数据源，我这边的记录不直接改 U8。`);
  };

  return (
    <div class="editor-backdrop" onClick={onClose}>
      <div class="editor-panel" role="dialog" aria-modal="true" onClick={(ev) => ev.stopPropagation()}>
        <header class="editor-head">
          <h3>编辑资料 · {task.title}</h3>
          <button class="btn-icon" onClick={onClose} aria-label="关闭"><Icon name="close" size={16} /></button>
        </header>

        <div class="editor-body">
          {task.materialCode && (
            <div class="editor-field">
              <div class="editor-fact">
                <span class="editor-fact-label">货码</span>
                <span class="editor-fact-value">{task.materialCode}{task.materialName ? ` ${task.materialName}` : ""}</span>
                <span class="editor-fact-src">ⓘ U8 · {fmtStamp(task.updatedAt)}</span>
              </div>
              <div class="editor-judgment">
                <span class="editor-judgment-arrow">↳</span>
                <input class="input" placeholder="核实后的实际货码" value={form.materialCodeFix ?? ""} onInput={(ev) => set("materialCodeFix", (ev.target as HTMLInputElement).value)} />
                {!!form.materialCodeFix && <button class="btn btn-sm" onClick={() => useThis("货码", form.materialCodeFix!)}>用这个</button>}
              </div>
              <p class="editor-note muted">不改 U8 货码档案与打分——只是并列记一笔，[用这个] 生成核对卡去改数据源。</p>
            </div>
          )}

          <div class="editor-field">
            {task.supplier && (
              <div class="editor-fact">
                <span class="editor-fact-label">供应商</span>
                <span class="editor-fact-value">{task.supplier}</span>
                <span class="editor-fact-src">ⓘ U8 主供应商</span>
              </div>
            )}
            <div class="editor-judgment">
              <span class="editor-judgment-arrow">↳</span>
              <input class="input" placeholder="本单实际供应商（启用备选）" value={form.supplierOverride ?? ""} onInput={(ev) => set("supplierOverride", (ev.target as HTMLInputElement).value)} />
              {!!form.supplierOverride && <button class="btn btn-sm" onClick={() => useThis("本单供应商", form.supplierOverride!)}>用这个</button>}
            </div>
          </div>

          <div class="editor-field">
            {(task.dueDate || task.needDate) && (
              <div class="editor-fact">
                <span class="editor-fact-label">{task.dueDate ? "最晚动作日" : "需求日期"}</span>
                <span class="editor-fact-value">{task.dueDate ?? task.needDate}</span>
                <span class="editor-fact-src">ⓘ {task.dueDate ? "系统算" : "生产表"}</span>
              </div>
            )}
            <div class="editor-judgment editor-judgment-stack">
              <span class="editor-judgment-arrow">↳</span>
              <div class="editor-judgment-inputs">
                <input class="input" type="date" title="承诺到货日（供应商给的）" value={form.promiseDate ?? ""} onInput={(ev) => set("promiseDate", (ev.target as HTMLInputElement).value)} />
                <select class="input" value={form.promiseSource ?? ""} onChange={(ev) => set("promiseSource", ((ev.target as HTMLSelectElement).value || undefined) as EditableFields["promiseSource"])}>
                  <option value="">承诺来源…</option>
                  {(Object.keys(PROMISE_SOURCE_LABEL) as (keyof typeof PROMISE_SOURCE_LABEL)[]).map((k) => (
                    <option key={k} value={k}>{PROMISE_SOURCE_LABEL[k]}</option>
                  ))}
                </select>
              </div>
            </div>
            <p class={`editor-note ${form.promiseSource === "signback" ? "editor-note-ok" : ""}`}>
              {form.promiseSource === "signback" ? "✓ 书面回签，这个日期会参与排序" : "只有「书面回签」会参与排序——口头 / 我猜的不进打分，只做记录"}
            </p>
          </div>

          <div class="editor-field editor-field-row">
            <div>
              <label class="editor-label">物流预计到达</label>
              <input class="input" type="date" value={form.etaDate ?? ""} onInput={(ev) => set("etaDate", (ev.target as HTMLInputElement).value)} />
            </div>
            <div>
              <label class="editor-label">物流公司 + 运单号</label>
              <input class="input" placeholder="如：顺丰 SF1234567890" value={form.trackingNo ?? ""} onInput={(ev) => set("trackingNo", (ev.target as HTMLInputElement).value)} />
            </div>
          </div>

          <div class="editor-field">
            <label class="editor-label">明天几点再动（允许未闭环，不允许没交代）</label>
            <input class="input" type="datetime-local" value={form.nextActionAt ?? ""} onInput={(ev) => set("nextActionAt", (ev.target as HTMLInputElement).value)} />
          </div>

          <div class="editor-field editor-field-row">
            <div>
              <label class="editor-label">卡在谁那里</label>
              <select class="input" value={form.blockedBy ?? "none"} onChange={(ev) => set("blockedBy", (ev.target as HTMLSelectElement).value as EditableFields["blockedBy"])}>
                {(Object.keys(BLOCKED_LABEL) as (keyof typeof BLOCKED_LABEL)[]).map((k) => (
                  <option key={k} value={k}>{BLOCKED_LABEL[k]}</option>
                ))}
              </select>
            </div>
            <div>
              <label class="editor-label">已升级给谁</label>
              <input class="input" placeholder="如：采购主管老王" value={form.escalatedTo ?? ""} onInput={(ev) => set("escalatedTo", (ev.target as HTMLInputElement).value)} />
            </div>
          </div>

          <div class="editor-field">
            <label class="editor-label">备注（自由文本，不参与任何计算）</label>
            <textarea class="input editor-textarea" rows={3} value={form.note ?? ""} onInput={(ev) => set("note", (ev.target as HTMLTextAreaElement).value)} />
          </div>
        </div>

        <footer class="editor-foot">
          <button class="btn" onClick={onClose}>取消</button>
          <button class="btn btn-primary" onClick={() => onSave(form)}>保存</button>
        </footer>
      </div>
    </div>
  );
}
