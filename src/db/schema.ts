// IndexedDB 数据模型（Dexie）。所有用户数据只在这台浏览器里，见 docs/ARCHITECTURE.md §隐私。
import Dexie, { type EntityTable } from "dexie";
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

export const db = new XiaocaiDB();
