// 收工完成态：苏姐规格 §3.5——日清不是清空页面，是产出一条「可以发给领导的消息」。
// 渲染时机由 BoardView 决定（day.canClose 为真时用它替掉泳道区），本文件只管这一屏怎么长。
import { useState } from "preact/hooks";
import type { BoardTask } from "../board/types";
import { copyText, formatBizDate } from "./TaskCard";
import { Icon } from "./icons";

interface DayCloseProps {
  bizDate: string;
  handoverText: string;
  /** 已经是 status==='done' 的任务，用来生成「今天你做成的事」。 */
  doneTasks: BoardTask[];
  /** 还没关掉的任务（正常情况下 canClose 时应为空，兜底：真有剩的就如实说，不编"明天N件事"）。 */
  pendingTasks: BoardTask[];
  onCloseDay: () => void;
}

export function DayClose({ bizDate, handoverText, doneTasks, pendingTasks, onCloseDay }: DayCloseProps) {
  const [dismissed, setDismissed] = useState(false);
  const [copied, setCopied] = useState(false);
  const total = doneTasks.length + pendingTasks.length;

  const copy = async () => {
    if (await copyText(handoverText)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  return (
    <div class="day-close">
      <div class="day-close-hero">
        <div class="day-close-check"><Icon name="done" size={34} tone="ok" /></div>
        <h2>今天清完了 · {doneTasks.length}/{total || doneTasks.length}</h2>
        <p class="muted">{formatBizDate(bizDate)}</p>
      </div>

      {doneTasks.length > 0 && (
        <section class="day-close-block">
          <h4>今天你做成的事</h4>
          <ul>
            {doneTasks.map((t) => (
              <li key={t.id}>{t.title}{t.doneRule ? `（${t.doneRule}）` : ""}</li>
            ))}
          </ul>
        </section>
      )}

      {handoverText && !dismissed && (
        <section class="day-close-block day-close-handover">
          <h4>发给领导（复制就能发）</h4>
          <p class="day-close-handover-text">{handoverText}</p>
          <div class="day-close-handover-actions">
            <button class="btn btn-primary" onClick={copy}>{copied ? "已复制" : "复制"}</button>
            <button class="btn-link" onClick={() => setDismissed(true)}>今天先不发</button>
          </div>
        </section>
      )}
      {handoverText && dismissed && (
        <p class="muted">
          好，先不发，文案还留着。 <button class="btn-link" onClick={() => setDismissed(false)}>撤销</button>
        </p>
      )}

      <section class="day-close-block">
        <h4>{pendingTasks.length > 0 ? `还有 ${pendingTasks.length} 件事没关掉` : "明天早上等你的事"}</h4>
        {pendingTasks.length > 0 ? (
          <ul>{pendingTasks.map((t) => <li key={t.id}>{t.title}</li>)}</ul>
        ) : (
          <p class="muted">明早导入生产表 / 订单执行报表后，新的待办会自动出现在这里。</p>
        )}
      </section>

      <button class="btn btn-primary btn-block day-close-btn" onClick={onCloseDay}>收工</button>
    </div>
  );
}
