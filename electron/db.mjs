// 桌面端持久层：node:sqlite（Electron 38 内置 Node 22，无需任何原生编译，见 docs/ARCHITECTURE.md §桌面化）。
// 设计取舍：老表沿用「id + 若干索引列 + data(JSON)」的宽表，让渲染进程的 Dexie 兼容层零改造接上；
// 新表（文档/切片/看板/学习）用真正的关系表 + FTS5，检索走 SQLite 自带 bm25()。
import { DatabaseSync } from "node:sqlite";

/** 与原 Dexie stores 一一对应：表名 → 需要单独建列的索引字段（其余字段留在 data JSON 里） */
export const TABLE_SPEC = {
  sessions: ["updatedAt"],
  messages: ["sessionId", "createdAt"],
  summaries: ["sessionId"],
  materials: ["role", "name"],
  enhancements: ["origin", "enabled"],
  feedback: ["sessionId", "messageId"],
  settings: [],
};
/** settings 的主键是 key 不是 id */
const PK = { settings: "key" };
const pk = (t) => PK[t] ?? "id";

/** 索引列类型：数字列用 INTEGER，布尔在 JS 侧转 0/1（IndexedDB 不认布尔索引的坑在 SQLite 里同样要防） */
const NUM_COLS = new Set(["updatedAt", "createdAt", "enabled"]);

let db;

export function openDb(file) {
  db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  migrate();
  return db;
}
export const handle = () => db;

function migrate() {
  for (const [table, idx] of Object.entries(TABLE_SPEC)) {
    const cols = [`${pk(table)} TEXT PRIMARY KEY`, ...idx.map((c) => `${c} ${NUM_COLS.has(c) ? "INTEGER" : "TEXT"}`), "data TEXT NOT NULL"];
    db.exec(`CREATE TABLE IF NOT EXISTS ${table} (${cols.join(", ")})`);
    for (const c of idx) db.exec(`CREATE INDEX IF NOT EXISTS idx_${table}_${c} ON ${table}(${c})`);
  }

  // ---- 知识库：文档 → 切片 → FTS5 全文索引 ----
  db.exec(`CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, sourceName TEXT, mime TEXT,
    category TEXT NOT NULL DEFAULT 'other', tags TEXT NOT NULL DEFAULT '[]',
    summary TEXT, charCount INTEGER NOT NULL DEFAULT 0, chunkCount INTEGER NOT NULL DEFAULT 0,
    createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_documents_cat ON documents(category)`);
  db.exec(`CREATE TABLE IF NOT EXISTS chunks (
    id TEXT PRIMARY KEY, docId TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    seq INTEGER NOT NULL, heading TEXT, category TEXT NOT NULL DEFAULT 'other',
    text TEXT NOT NULL, createdAt INTEGER NOT NULL)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_chunks_doc ON chunks(docId)`);
  // 中文没有词边界，FTS5 默认分词器会把整段当一个 token ⇒ 建索引和查询都先切成 bigram（见 features.mjs 的 toGrams）。
  // 用普通（非 contentless）FTS5 表：contentless 表不支持 DELETE，删文档时会直接报 "SQL logic error"（实测踩过）。
  db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(chunkId UNINDEXED, gram)`);

  // ---- 工作看板 ----
  db.exec(`CREATE TABLE IF NOT EXISTS board_tasks (
    id TEXT PRIMARY KEY, kind TEXT NOT NULL, title TEXT NOT NULL, materialCode TEXT, materialName TEXT,
    supplier TEXT, poNo TEXT, qty REAL, needDate TEXT, promiseDate TEXT, dueDate TEXT,
    stage TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'todo', score REAL NOT NULL DEFAULT 0,
    reasons TEXT NOT NULL DEFAULT '[]', steps TEXT NOT NULL DEFAULT '[]', doneSteps TEXT NOT NULL DEFAULT '[]',
    doneRule TEXT, escalation TEXT, sourceRow TEXT, note TEXT,
    bizDate TEXT NOT NULL, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL, closedAt INTEGER)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_task_date ON board_tasks(bizDate, status)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_task_stage ON board_tasks(stage)`);
  db.exec(`CREATE TABLE IF NOT EXISTS board_days (
    bizDate TEXT PRIMARY KEY, checklist TEXT NOT NULL DEFAULT '{}', closedAt INTEGER, note TEXT)`);

  // ---- 学习计划 ----
  db.exec(`CREATE TABLE IF NOT EXISTS learning_progress (
    itemId TEXT PRIMARY KEY, status TEXT NOT NULL DEFAULT 'todo',
    score INTEGER, note TEXT, startedAt INTEGER, doneAt INTEGER, updatedAt INTEGER NOT NULL)`);
}

// ---------- 老表：Dexie 兼容层的服务端实现 ----------
const enc = (table, row) => {
  const idx = TABLE_SPEC[table] ?? [];
  const vals = idx.map((c) => {
    const v = row[c];
    if (v === undefined || v === null) return null;
    if (NUM_COLS.has(c)) return typeof v === "boolean" ? (v ? 1 : 0) : Number(v);
    return String(v);
  });
  return [String(row[pk(table)]), ...vals, JSON.stringify(row)];
};
const dec = (r) => (r ? JSON.parse(r.data) : undefined);

export function tableAll(table) {
  return db.prepare(`SELECT data FROM ${table}`).all().map(dec);
}
export function tableGet(table, id) {
  return dec(db.prepare(`SELECT data FROM ${table} WHERE ${pk(table)} = ?`).get(String(id)));
}
export function tableByIndex(table, field, value) {
  const v = NUM_COLS.has(field) ? (typeof value === "boolean" ? (value ? 1 : 0) : Number(value)) : String(value);
  return db.prepare(`SELECT data FROM ${table} WHERE ${field} = ?`).all(v).map(dec);
}
export function tablePut(table, rows, mode = "put") {
  const idx = TABLE_SPEC[table] ?? [];
  const cols = [pk(table), ...idx, "data"];
  const verb = mode === "add" ? "INSERT" : "INSERT OR REPLACE";
  const stmt = db.prepare(`${verb} INTO ${table} (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`);
  db.exec("BEGIN");
  try {
    for (const row of rows) stmt.run(...enc(table, row));
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return rows.length;
}
export function tableUpdate(table, id, patch) {
  const cur = tableGet(table, id);
  if (!cur) return 0;
  tablePut(table, [{ ...cur, ...patch }]);
  return 1;
}
export function tableDelete(table, ids) {
  const stmt = db.prepare(`DELETE FROM ${table} WHERE ${pk(table)} = ?`);
  for (const id of ids) stmt.run(String(id));
  return ids.length;
}
export function tableDeleteByIndex(table, field, value) {
  const v = NUM_COLS.has(field) ? Number(value) : String(value);
  const info = db.prepare(`DELETE FROM ${table} WHERE ${field} = ?`).run(v);
  return Number(info.changes ?? 0);
}
