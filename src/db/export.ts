// 备份 / 恢复 / 导出。全量 JSON 不含 apiKey（它本来就在 localStorage，这里再显式过滤一次 settings 表）。
import { format } from "date-fns";
import {
  db,
  type EnhancementRow,
  type FeedbackRow,
  type MaterialRow,
  type MessageRow,
  type SessionRow,
  type SettingRow,
  type SummaryRow,
} from "./schema";
import { newId } from "../util/id";

export const SCHEMA_VERSION = 1 as const;
export const EXPORTED_AT_KEY = "exportedAt";

export type SerializedMaterial = Omit<MaterialRow, "rawBlob"> & { rawBase64?: string; rawType?: string };

export interface ExportBundle {
  schemaVersion: typeof SCHEMA_VERSION;
  app: "xiaocai";
  exportedAt: string;
  sessions: SessionRow[];
  messages: MessageRow[];
  summaries: SummaryRow[];
  enhancements: EnhancementRow[];
  feedback: FeedbackRow[];
  settings: SettingRow[];
  materials?: SerializedMaterial[];
}

export interface EnhancementBundle {
  schemaVersion: typeof SCHEMA_VERSION;
  kind: "enhancements";
  exportedAt: string;
  enhancements: EnhancementRow[];
}

const isSecretKey = (key: string) => /apikey/i.test(key);

/** settings 表里凡 key 含 apiKey 的行一律不导出、不导入 */
export function filterSettings(rows: SettingRow[]): SettingRow[] {
  return rows.filter((r) => !isSecretKey(r.key));
}

export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(bin);
}

export function base64ToBlob(b64: string, type = "application/octet-stream"): Blob {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

async function serializeMaterial(m: MaterialRow): Promise<SerializedMaterial> {
  const { rawBlob, ...rest } = m;
  if (!rawBlob) return rest;
  return { ...rest, rawBase64: await blobToBase64(rawBlob), rawType: rawBlob.type || undefined };
}

function deserializeMaterial(s: SerializedMaterial): MaterialRow {
  const { rawBase64, rawType, ...rest } = s;
  return rawBase64 ? { ...rest, rawBlob: base64ToBlob(rawBase64, rawType) } : rest;
}

/** 全量导出为 JSON Blob；顺手把 settings.exportedAt 记为现在 */
export async function exportAll(opts: { includeMaterials: boolean }): Promise<Blob> {
  const exportedAt = new Date().toISOString();
  const [sessions, messages, summaries, enhancements, feedback, settings] = await Promise.all([
    db.sessions.toArray(),
    db.messages.toArray(),
    db.summaries.toArray(),
    db.enhancements.toArray(),
    db.feedback.toArray(),
    db.settings.toArray(),
  ]);
  const bundle: ExportBundle = {
    schemaVersion: SCHEMA_VERSION,
    app: "xiaocai",
    exportedAt,
    sessions,
    messages,
    summaries,
    enhancements,
    feedback,
    settings: filterSettings(settings),
  };
  if (opts.includeMaterials) {
    const mats = await db.materials.toArray();
    bundle.materials = await Promise.all(mats.map(serializeMaterial));
  }
  await db.settings.put({ key: EXPORTED_AT_KEY, value: exportedAt });
  return new Blob([JSON.stringify(bundle)], { type: "application/json" });
}

export interface ImportCounts {
  sessions: number;
  messages: number;
  summaries: number;
  enhancements: number;
  feedback: number;
  settings: number;
  materials: number;
}

function assertArray<T>(v: unknown, name: string): T[] {
  if (v === undefined) return [];
  if (!Array.isArray(v)) throw new Error(`备份文件里的 ${name} 不是数组`);
  return v as T[];
}

/** 从全量 JSON 合并导入（bulkPut，不清库；同 id 覆盖） */
export async function importAll(file: File | Blob): Promise<{ counts: ImportCounts }> {
  let data: Partial<ExportBundle>;
  try {
    data = JSON.parse(await file.text());
  } catch {
    throw new Error("不是合法的 JSON 备份文件");
  }
  if (data.schemaVersion !== SCHEMA_VERSION) throw new Error(`备份版本不匹配：期望 ${SCHEMA_VERSION}，文件是 ${String(data.schemaVersion)}`);

  const sessions = assertArray<SessionRow>(data.sessions, "sessions");
  const messages = assertArray<MessageRow>(data.messages, "messages");
  const summaries = assertArray<SummaryRow>(data.summaries, "summaries");
  const enhancements = assertArray<EnhancementRow>(data.enhancements, "enhancements");
  const feedback = assertArray<FeedbackRow>(data.feedback, "feedback");
  const settings = filterSettings(assertArray<SettingRow>(data.settings, "settings")).filter((s) => s.key !== EXPORTED_AT_KEY);
  const materials = assertArray<SerializedMaterial>(data.materials, "materials").map(deserializeMaterial);

  await db.transaction("rw", [db.sessions, db.messages, db.summaries, db.enhancements, db.feedback, db.settings, db.materials], async () => {
    if (sessions.length) await db.sessions.bulkPut(sessions);
    if (messages.length) await db.messages.bulkPut(messages);
    if (summaries.length) await db.summaries.bulkPut(summaries);
    if (enhancements.length) await db.enhancements.bulkPut(enhancements);
    if (feedback.length) await db.feedback.bulkPut(feedback);
    if (settings.length) await db.settings.bulkPut(settings);
    if (materials.length) await db.materials.bulkPut(materials);
  });

  return {
    counts: {
      sessions: sessions.length,
      messages: messages.length,
      summaries: summaries.length,
      enhancements: enhancements.length,
      feedback: feedback.length,
      settings: settings.length,
      materials: materials.length,
    },
  };
}

const fmtTime = (ms: number) => format(new Date(ms), "yyyy-MM-dd HH:mm");

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content))
    return content
      .filter((c: any) => c?.type === "text")
      .map((c: any) => String(c.text ?? ""))
      .join("\n");
  return "";
}

const quote = (s: string) =>
  s
    .split("\n")
    .map((l) => `> ${l}`)
    .join("\n");

/** 把一段 pi AgentMessage 渲染成 Markdown；user/assistant 出正文，toolCall 出一行，toolResult 出引用块 */
export function messageToMarkdown(m: any): string {
  const when = typeof m?.timestamp === "number" ? `（${fmtTime(m.timestamp)}）` : "";
  if (m?.role === "user") return `**我**${when}\n\n${textOf(m.content)}`;
  if (m?.role === "assistant") {
    const blocks = Array.isArray(m.content) ? m.content : [{ type: "text", text: textOf(m.content) }];
    const body = blocks
      .map((b: any) => {
        if (b?.type === "text") return b.text ?? "";
        if (b?.type === "toolCall") return `> 🔧 调用 \`${b.name}\`：\`${JSON.stringify(b.arguments ?? {})}\``;
        return "";
      })
      .filter(Boolean)
      .join("\n\n");
    return `**小采**${when}\n\n${body}`;
  }
  if (m?.role === "toolResult") {
    const head = `${m.isError ? "❌" : "✅"} ${m.toolName ?? "工具结果"}`;
    return quote(`${head}\n\n${textOf(m.content)}`);
  }
  return "";
}

/** 单会话导出 Markdown：标题 + 时间 + 逐条消息 + 小结（summaries 表若有） */
export async function exportSessionMarkdown(sessionId: string): Promise<string> {
  const session = await db.sessions.get(sessionId);
  if (!session) throw new Error("会话不存在");
  const msgs = await db.messages.where("sessionId").equals(sessionId).sortBy("createdAt");
  const summaries = await db.summaries.where("sessionId").equals(sessionId).toArray();

  const parts: string[] = [];
  parts.push(`# ${session.title || "未命名会话"}`);
  parts.push(`创建：${fmtTime(session.createdAt)} · 更新：${fmtTime(session.updatedAt)}${session.tags?.length ? ` · 标签：${session.tags.join("、")}` : ""}`);
  parts.push("");
  parts.push("## 对话");
  for (const r of msgs) {
    const md = messageToMarkdown(r.content);
    if (md) parts.push(md, "");
  }
  if (summaries.length) {
    parts.push("## 小结");
    for (const s of summaries.sort((a, b) => a.updatedAt - b.updatedAt)) {
      parts.push(`### ${s.kind}（${fmtTime(s.updatedAt)}）`);
      parts.push(s.text);
      if (s.keyFacts?.length) parts.push("", "**关键事实**", ...s.keyFacts.map((k) => `- ${k}`));
      if (s.openItems?.length) parts.push("", "**待办**", ...s.openItems.map((k) => `- [ ] ${k}`));
      parts.push("");
    }
  }
  parts.push("---", "由小采导出 · 资料只在本机浏览器");
  return parts.join("\n");
}

/** 只导出用户自建 / 教出来的增强卡（origin ≠ builtin） */
export async function exportEnhancements(): Promise<Blob> {
  const rows = (await db.enhancements.toArray()).filter((e) => e.origin !== "builtin");
  const bundle: EnhancementBundle = { schemaVersion: SCHEMA_VERSION, kind: "enhancements", exportedAt: new Date().toISOString(), enhancements: rows };
  return new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
}

/** 导入增强卡；id 冲突就换新 id；origin 一律记 user */
export async function importEnhancements(file: File | Blob): Promise<{ imported: number; renamed: number }> {
  let data: unknown;
  try {
    data = JSON.parse(await file.text());
  } catch {
    throw new Error("不是合法的 JSON 文件");
  }
  const list: unknown = Array.isArray(data) ? data : (data as Partial<EnhancementBundle>)?.enhancements;
  if (!Array.isArray(list)) throw new Error("文件里没有 enhancements 数组");

  const now = Date.now();
  let renamed = 0;
  const rows: EnhancementRow[] = [];
  for (const raw of list as Partial<EnhancementRow>[]) {
    if (!raw || typeof raw.name !== "string") continue;
    let id = typeof raw.id === "string" && raw.id ? raw.id : newId();
    if (await db.enhancements.get(id)) {
      id = newId();
      renamed++;
    }
    rows.push({
      id,
      name: raw.name,
      intents: raw.intents ?? [],
      triggers: raw.triggers ?? [],
      sop: raw.sop ?? [],
      cautions: raw.cautions ?? [],
      examples: raw.examples ?? [],
      enabled: raw.enabled ?? true,
      origin: "user",
      conflictsWith: raw.conflictsWith ?? [],
      sourceSessionId: raw.sourceSessionId,
      createdAt: raw.createdAt ?? now,
      updatedAt: now,
    });
  }
  if (rows.length) await db.enhancements.bulkAdd(rows);
  return { imported: rows.length, renamed };
}

/** 触发浏览器下载 */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, 0);
}

/** 文件名用的时间戳，例：20260903-1430 */
export const stampNow = () => format(new Date(), "yyyyMMdd-HHmm");

/** 文件名里去掉不安全字符 */
export const safeFilename = (s: string) => s.replace(/[\\/:*?"<>|\s]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "untitled";
