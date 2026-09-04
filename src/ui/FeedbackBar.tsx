import { useEffect, useState } from "preact/hooks";
import type { FeedbackRow } from "../db/schema";
import { markAdopted, vote } from "../db/feedback";
import { Icon } from "./icons";
import "./FeedbackBar.css";

interface Props {
  messageId: string;
  sessionId: string;
  /** 已有的反馈（外层用 getFeedbackFor 拿到后传入） */
  current?: FeedbackRow;
  /** 工具结果卡显示「已采用」切换（北极星辅助指标） */
  showAdopt?: boolean;
  /** 点「不对」后选「教它正确做法」 */
  onTeach?: () => void;
  /** 任何反馈落库后调用，外层刷新 current */
  onChange?: () => void;
}

/** 一行灰色的轻量反馈条：点赞 / 点踩 / (已采用)。hover 才显眼。 */
export function FeedbackBar({ messageId, sessionId, current, showAdopt, onTeach, onChange }: Props) {
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState(current?.note ?? "");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setNote(current?.note ?? "");
    if (current?.vote !== -1) setNoteOpen(false);
  }, [current?.note, current?.vote, messageId]);

  const v = current?.vote;
  const adopted = !!current?.adopted;

  const cast = async (val: 1 | -1) => {
    await vote(messageId, sessionId, val);
    setNoteOpen(val === -1);
    setSaved(false);
    onChange?.();
  };

  const saveNote = async () => {
    await vote(messageId, sessionId, -1, note);
    setSaved(true);
    onChange?.();
  };

  const toggleAdopt = async () => {
    await markAdopted(messageId, sessionId, !adopted);
    onChange?.();
  };

  return (
    <div class={`fb-bar${noteOpen ? " fb-open" : ""}`}>
      <div class="fb-row">
        <button class={`fb-btn${v === 1 ? " fb-active" : ""}`} title="有用" aria-label="有用" aria-pressed={v === 1} onClick={() => cast(1)}>
          <Icon name="thumbUp" size={14} />
        </button>
        <button
          class={`fb-btn${v === -1 ? " fb-active" : ""}`}
          title="不对"
          aria-label="不对"
          aria-pressed={v === -1}
          onClick={() => (v === -1 ? setNoteOpen(!noteOpen) : cast(-1))}
        >
          <Icon name="thumbDown" size={14} />
        </button>
        {showAdopt && (
          <button class={`fb-btn fb-adopt${adopted ? " fb-active" : ""}`} title="这个结果我用上了" aria-pressed={adopted} onClick={toggleAdopt}>
            <Icon name="check" size={13} /> {adopted ? "已采用" : "采用"}
          </button>
        )}
      </div>

      {noteOpen && (
        <div class="fb-note">
          <input
            value={note}
            placeholder="哪里不对？（可不填）"
            onInput={(e) => {
              setNote((e.target as HTMLInputElement).value);
              setSaved(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") saveNote();
            }}
          />
          <button class="fb-btn fb-text" onClick={saveNote}>{saved ? "已记下" : "记下"}</button>
          {onTeach && (
            <button class="fb-btn fb-text fb-teach" onClick={onTeach}>教它正确做法</button>
          )}
        </div>
      )}
    </div>
  );
}
