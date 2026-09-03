import { useState } from "preact/hooks";

interface Props {
  disabled: boolean;
  onSend: (text: string) => void;
  onAbort: () => void;
  streaming: boolean;
}

export function Composer({ disabled, onSend, onAbort, streaming }: Props) {
  const [text, setText] = useState("");
  const submit = () => {
    const t = text.trim();
    if (!t || disabled) return;
    onSend(t);
    setText("");
  };
  return (
    <div class="composer">
      <textarea
        value={text}
        placeholder={disabled ? "先在右上角「设置」填 API Key" : "问小采…（Enter 发送，Shift+Enter 换行）"}
        disabled={disabled}
        onInput={(e) => setText((e.target as HTMLTextAreaElement).value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
        rows={2}
      />
      {streaming ? (
        <button class="btn btn-stop" onClick={onAbort}>停止</button>
      ) : (
        <button class="btn btn-primary" onClick={submit} disabled={disabled || !text.trim()}>发送</button>
      )}
    </div>
  );
}
