// IndexedDB 数据模型（Dexie）。所有用户数据只在这台浏览器里，见 docs/ARCHITECTURE.md §隐私。
import Dexie, { type EntityTable } from "dexie";
import { isDesktop } from "../data/bridge";
import { SqliteTable } from "../data/sqlite-table";
import type { AgentMessage } from "@earendil-works/pi-agent-core";

export interface SessionRow {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  summaryId?: string;
  tags: string[];
}

export interface MessageRow {
  id: string;
  sessionId: string;
  role: string;
  /** pi 的 AgentMessage 原样落库，恢复时无损回灌 agent.state.messages */
  content: AgentMessage;
  createdAt: number;
}

export interface SummaryRow {
  id: string;
  sessionId: string;
  kind: "po_done" | "manual" | "close";
  text: string;
  keyFacts: string[];
  openItems: string[];
  updatedAt: number;
}

export interface MaterialRow {
  id: string;
  name: string;
  kind: "csv" | "xlsx" | "md" | "txt";
  /** materials=物料表 tracking=跟单表/订单执行报表 suppliers=供应商档案 doc=其他文档 */
  role: "materials" | "tracking" | "suppliers" | "doc";
  rawBlob?: Blob;
  rows?: Record<string, string>[];
  text?: string;
  version: number;
  createdAt: number;
}

export interface EnhancementRow {
  id: string;
  name: string;
  intents: string[];
  triggers: string[];
  sop: string[];
  cautions: string[];
  examples: string[];
  enabled: boolean;
  origin: "builtin" | "user" | "taught";
  conflictsWith: string[];
  sourceSessionId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface FeedbackRow {
  id: string;
  messageId: string;
  sessionId: string;
  vote: 1 | -1;
  note?: string;
  /** 工具结果卡「已采用」——北极星辅助指标 */
  adopted?: boolean;
  createdAt: number;
}

export interface SettingRow {
  key: string;
  value: unknown;
}

export class XiaocaiDB extends Dexie {
  sessions!: EntityTable<SessionRow, "id">;
  messages!: EntityTable<MessageRow, "id">;
  summaries!: EntityTable<SummaryRow, "id">;
  materials!: EntityTable<MaterialRow, "id">;
  enhancements!: EntityTable<EnhancementRow, "id">;
  feedback!: EntityTable<FeedbackRow, "id">;
  settings!: EntityTable<SettingRow, "key">;

  constructor() {
    super("xiaocai");
    this.version(1).stores({
      sessions: "id, updatedAt",
      messages: "id, sessionId, createdAt",
      summaries: "id, sessionId",
      materials: "id, role, name",
      enhancements: "id, origin, enabled",
      feedback: "id, sessionId, messageId",
      settings: "key",
    });
  }
}

/**
 * 存储后端在启动时定一次：
 * - 桌面版（Electron）→ SQLite（node:sqlite），数据落在 userData/xiaocai.sqlite，可备份、可用 sqlite3 直接查
 * - 网页版 → 原有 Dexie/IndexedDB，保持 GitHub Pages 上那份能继续用
 * 两边暴露同一套 API（见 src/data/sqlite-table.ts 的兼容层），业务代码不感知差异。
 */
export interface XiaocaiStore {
  /**
   * Dexie 的 db.transaction(mode, ...tables, fn) 兼容签名。
   * SQLite 后端下不开显式事务：桌面版是单用户单进程，且每次批量写在主进程里已经包在 BEGIN/COMMIT 里；
   * 这里只负责把回调跑起来，保证调用点不用分叉。真需要跨语句原子性时，去主进程加一个具名接口。
   */
  transaction<T>(mode: string, ...args: unknown[]): Promise<T>;
  sessions: SqliteTable<SessionRow>;
  messages: SqliteTable<MessageRow>;
  summaries: SqliteTable<SummaryRow>;
  materials: SqliteTable<MaterialRow>;
  enhancements: SqliteTable<EnhancementRow>;
  feedback: SqliteTable<FeedbackRow>;
  settings: SqliteTable<SettingRow>;
}

function sqliteStore(): XiaocaiStore {
  return {
    transaction: <T,>(_mode: string, ...args: unknown[]) => (args[args.length - 1] as () => Promise<T>)(),
    sessions: new SqliteTable<SessionRow>("sessions"),
    messages: new SqliteTable<MessageRow>("messages"),
    summaries: new SqliteTable<SummaryRow>("summaries"),
    materials: new SqliteTable<MaterialRow>("materials"),
    enhancements: new SqliteTable<EnhancementRow>("enhancements"),
    feedback: new SqliteTable<FeedbackRow>("feedback"),
    settings: new SqliteTable<SettingRow>("settings"),
  };
}

export const backend: "sqlite" | "indexeddb" = isDesktop() ? "sqlite" : "indexeddb";
export const db: XiaocaiStore = backend === "sqlite" ? sqliteStore() : (new XiaocaiDB() as unknown as XiaocaiStore);
