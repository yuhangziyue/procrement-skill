// 全局图标系统。规则：界面里不再出现 emoji，一律用这里的 SVG。
// 设计口径：24×24 viewBox、线性描边（stroke=currentColor、width=1.6、round cap/join）、无填充，
// 颜色随文字走（currentColor），大小由 size 控制。新增图标请沿用同一套参数，否则视觉会花。
import type { JSX } from "preact";

export type IconName =
  // 导航
  | "board" | "knowledge" | "tutorial" | "learning" | "settings"
  // 对话
  | "chat" | "send" | "stop" | "plus" | "history" | "summary" | "close" | "drag"
  // 动作
  | "search" | "import" | "export" | "refresh" | "copy" | "check" | "trash" | "edit" | "link" | "external"
  // 状态与语义
  | "alert" | "warning" | "info" | "clock" | "overdue" | "done" | "blocked" | "lock" | "star"
  | "thumbUp" | "thumbDown" | "sparkle" | "gap" | "book" | "video" | "file" | "folder" | "card"
  | "truck" | "inbox" | "phone" | "chevronRight" | "chevronDown" | "tool" | "brain";

const P: Record<IconName, JSX.Element | JSX.Element[]> = {
  board: [<rect x="3" y="4" width="18" height="16" rx="2" />, <path d="M9 4v16M15 4v16" />],
  knowledge: [<path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H19v14H5.5A1.5 1.5 0 0 0 4 19.5z" />, <path d="M4 19.5A1.5 1.5 0 0 1 5.5 18H19v2.5H5.5A1.5 1.5 0 0 1 4 19.5z" />],
  tutorial: [<rect x="2.5" y="4" width="19" height="13" rx="2" />, <path d="M8 21h8M12 17v4" />],
  learning: [<path d="M12 4 2.5 9 12 14l9.5-5z" />, <path d="M6.5 11.2V16c0 1.4 2.5 2.8 5.5 2.8s5.5-1.4 5.5-2.8v-4.8" />],
  settings: [<circle cx="12" cy="12" r="3" />, <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 9 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 9a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z" />],

  chat: <path d="M20 14.5a2.5 2.5 0 0 1-2.5 2.5H8l-4 3.5V6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5z" />,
  send: [<path d="M21 3 10.5 13.5" />, <path d="M21 3l-6.8 18-3.7-7.5L3 9.8z" />],
  stop: <rect x="6" y="6" width="12" height="12" rx="1.5" />,
  plus: <path d="M12 5v14M5 12h14" />,
  history: [<path d="M3.2 12a8.8 8.8 0 1 0 2.6-6.2" />, <path d="M3 4v4h4" />, <path d="M12 7.5V12l3 1.8" />],
  summary: [<path d="M5 3.5h9L19 8v12.5H5z" />, <path d="M14 3.5V8h5" />, <path d="M8.5 13h7M8.5 16.5h4.5" />],
  close: <path d="M6 6l12 12M18 6L6 18" />,
  drag: [<circle cx="9" cy="6" r="1.1" />, <circle cx="15" cy="6" r="1.1" />, <circle cx="9" cy="12" r="1.1" />, <circle cx="15" cy="12" r="1.1" />, <circle cx="9" cy="18" r="1.1" />, <circle cx="15" cy="18" r="1.1" />],

  search: [<circle cx="11" cy="11" r="6.5" />, <path d="M15.8 15.8 21 21" />],
  import: [<path d="M12 3v11" />, <path d="M8 10.5 12 14.5l4-4" />, <path d="M4 17v2.5A1.5 1.5 0 0 0 5.5 21h13a1.5 1.5 0 0 0 1.5-1.5V17" />],
  export: [<path d="M12 15V4" />, <path d="M8 7.5 12 3.5l4 4" />, <path d="M4 17v2.5A1.5 1.5 0 0 0 5.5 21h13a1.5 1.5 0 0 0 1.5-1.5V17" />],
  refresh: [<path d="M20.5 12a8.5 8.5 0 1 1-2.5-6" />, <path d="M21 3v5h-5" />],
  copy: [<rect x="8.5" y="8.5" width="12" height="12" rx="2" />, <path d="M15.5 5.5v-1A1.5 1.5 0 0 0 14 3H5a2 2 0 0 0-2 2v9a1.5 1.5 0 0 0 1.5 1.5h1" />],
  check: <path d="M4.5 12.5 9.5 17.5 19.5 6.5" />,
  trash: [<path d="M4 6.5h16" />, <path d="M9 6.5V4.5A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5v2" />, <path d="M6.5 6.5 7.5 20a1.5 1.5 0 0 0 1.5 1.4h6a1.5 1.5 0 0 0 1.5-1.4l1-13.5" />],
  edit: [<path d="M4 20h4L20 8a2.1 2.1 0 0 0-3-3L5 17z" />, <path d="M15 6l3 3" />],
  link: [<path d="M10 13.5a4 4 0 0 0 5.7 0l3-3a4 4 0 1 0-5.7-5.7l-1.3 1.3" />, <path d="M14 10.5a4 4 0 0 0-5.7 0l-3 3a4 4 0 1 0 5.7 5.7l1.3-1.3" />],
  external: [<path d="M18 13v6a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 19V7.5A1.5 1.5 0 0 1 5 6h6" />, <path d="M15 3h6v6" />, <path d="M10.5 13.5 21 3" />],

  alert: [<circle cx="12" cy="12" r="9" />, <path d="M12 7.5v5.5" />, <circle cx="12" cy="16.4" r=".9" fill="currentColor" stroke="none" />],
  warning: [<path d="M12 3.5 22 20H2z" />, <path d="M12 9.5V14" />, <circle cx="12" cy="17" r=".9" fill="currentColor" stroke="none" />],
  info: [<circle cx="12" cy="12" r="9" />, <path d="M12 11v5.5" />, <circle cx="12" cy="7.8" r=".9" fill="currentColor" stroke="none" />],
  clock: [<circle cx="12" cy="12" r="9" />, <path d="M12 6.8V12l3.4 2" />],
  overdue: [<circle cx="12" cy="12" r="9" />, <path d="M12 6.8V12l3.4 2" />, <path d="M18.5 4.5 21.5 7.5" />],
  done: [<circle cx="12" cy="12" r="9" />, <path d="M8 12.3l2.8 2.8L16.2 9.5" />],
  blocked: [<circle cx="12" cy="12" r="9" />, <path d="M5.8 5.8 18.2 18.2" />],
  lock: [<rect x="4.5" y="10.5" width="15" height="10" rx="2" />, <path d="M8 10.5V7.6a4 4 0 1 1 8 0v2.9" />],
  star: <path d="m12 3.5 2.6 5.5 6 .9-4.3 4.2 1 6-5.3-2.8L6.7 20l1-6L3.4 9.9l6-.9z" />,
  thumbUp: [<path d="M7 10.5 11 3a2.4 2.4 0 0 1 2.4 2.4V9h4.9a2 2 0 0 1 2 2.4l-1.4 6.6a2 2 0 0 1-2 1.5H7" />, <rect x="2.5" y="10.5" width="4.5" height="9.5" rx="1.2" />],
  thumbDown: [<path d="M17 13.5 13 21a2.4 2.4 0 0 1-2.4-2.4V15H5.7a2 2 0 0 1-2-2.4l1.4-6.6a2 2 0 0 1 2-1.5H17" />, <rect x="17" y="4" width="4.5" height="9.5" rx="1.2" />],
  sparkle: [<path d="M12 3.5 13.7 9 19 10.7 13.7 12.4 12 18 10.3 12.4 5 10.7 10.3 9z" />, <path d="M18.5 16.5 19.2 18.6 21.3 19.3 19.2 20 18.5 22 17.8 20 15.8 19.3 17.8 18.6z" />],
  gap: [<path d="M9.5 4.5H5.5A1.5 1.5 0 0 0 4 6v12a1.5 1.5 0 0 0 1.5 1.5h4" />, <path d="M14.5 4.5h4A1.5 1.5 0 0 1 20 6v12a1.5 1.5 0 0 1-1.5 1.5h-4" />, <path d="M12 8v2M12 13v3" strokeDasharray="0.1 3.4" />],
  book: [<path d="M4 4.5h6a3 3 0 0 1 2 5.2V20a3.4 3.4 0 0 0-2-1H4z" />, <path d="M20 4.5h-6a3 3 0 0 0-2 5.2V20a3.4 3.4 0 0 1 2-1h6z" />],
  video: [<rect x="2.5" y="5" width="14" height="14" rx="2.5" />, <path d="M16.5 10.5 21.5 7.5v9l-5-3z" />],
  file: [<path d="M6 3.5h7L18.5 9v11.5h-12z" />, <path d="M13 3.5V9h5.5" />],
  folder: <path d="M3.5 6.5A1.5 1.5 0 0 1 5 5h4l2 2.5h8a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 19 19.5H5A1.5 1.5 0 0 1 3.5 18z" />,
  card: [<rect x="3" y="5.5" width="18" height="13" rx="2" />, <path d="M3 10h18M7 14.5h4" />],
  truck: [<path d="M2.5 6.5h11v9h-11z" />, <path d="M13.5 10h3.6l2.9 3v2.5h-6.5z" />, <circle cx="7" cy="17.5" r="1.9" />, <circle cx="16.5" cy="17.5" r="1.9" />],
  inbox: [<path d="M3.5 13.5 6 5h12l2.5 8.5v5A1.5 1.5 0 0 1 19 20H5a1.5 1.5 0 0 1-1.5-1.5z" />, <path d="M3.5 13.5H8l1.3 2.2h5.4L16 13.5h4.5" />],
  phone: <path d="M6.5 3.5h3l1.5 4-2 1.5a12 12 0 0 0 6 6l1.5-2 4 1.5v3a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 4.5 5.7 2 2 0 0 1 6.5 3.5z" />,
  chevronRight: <path d="M9 5l7 7-7 7" />,
  chevronDown: <path d="M5 9l7 7 7-7" />,
  // 扳手：工具调用标签用（原先借齿轮，语义不准）
  tool: <path d="M20.3 5.3a5.5 5.5 0 0 1-7.1 7.1L5.6 20a2.1 2.1 0 0 1-3-3l7.6-7.6a5.5 5.5 0 0 1 7.1-7.1l-3.2 3.2.7 3.3 3.3.7z" />,
  // 推理：思考过程折叠标题用
  brain: [<path d="M9.5 4.2A3 3 0 0 0 6 7.1a3 3 0 0 0-1.6 5A3.2 3.2 0 0 0 6.2 17a3 3 0 0 0 5.3 1.9V4.6a3 3 0 0 0-2-.4z" />, <path d="M14.5 4.2A3 3 0 0 1 18 7.1a3 3 0 0 1 1.6 5A3.2 3.2 0 0 1 17.8 17a3 3 0 0 1-5.3 1.9V4.6a3 3 0 0 1 2-.4z" />],
};

export interface IconProps extends Omit<JSX.SVGAttributes<SVGSVGElement>, "size"> {
  name: IconName;
  size?: number;
  /** 语气色：跟随文字(默认) / 危险 / 警示 / 成功 / 弱化 */
  tone?: "current" | "danger" | "warn" | "ok" | "muted";
}

const TONE: Record<NonNullable<IconProps["tone"]>, string | undefined> = {
  current: undefined,
  danger: "var(--danger, #c0392b)",
  warn: "var(--warn, #b8860b)",
  ok: "var(--ok, #2e7355)",
  muted: "var(--ink-3, #8a8f9a)",
};

export function Icon({ name, size = 16, tone = "current", style, ...rest }: IconProps) {
  const d = P[name];
  return (
    <svg
      viewBox="0 0 24 24" width={size} height={size} fill="none"
      stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"
      aria-hidden="true" focusable="false"
      style={{ flex: "none", display: "block", color: TONE[tone], ...(style as object) }}
      {...rest}
    >
      {d}
    </svg>
  );
}

/** 品牌标记：小采的「采」取"手采摘"之意——一只手落在一片叶上。用于标题栏与关于页。 */
export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} fill="none" aria-hidden="true" focusable="false">
      <rect x="1.5" y="1.5" width="29" height="29" rx="8" fill="var(--brand, #A8462E)" />
      <path d="M16 8.5c-3.6 0-6.5 2.6-6.5 5.9 0 3.6 3 6.6 6.5 9.1 3.5-2.5 6.5-5.5 6.5-9.1 0-3.3-2.9-5.9-6.5-5.9z" stroke="#fff" stroke-width="1.7" stroke-linejoin="round" />
      <path d="M16 12.2v8.4M16 15.4l2.6-2M16 18.2l-2.6-2" stroke="#fff" stroke-width="1.5" stroke-linecap="round" />
    </svg>
  );
}
