// 新表（知识库 / 看板 / 学习计划）的服务端 CRUD。刻意只做存取，不含业务判断——
// 优先级打分、任务生成、分类规则一律留在渲染进程的 TS 里，那边有 vitest 覆盖。
import { handle } from "./db.mjs";

// ---------- 中文 bigram 分词：FTS5 默认分词器不切中文，索引与查询都用同一套 ----------
const CJK = /[㐀-鿿豈-﫿]/;
export function toGrams(text) {
  const out = [];
  const tokens = String(text ?? "").toLowerCase().match(/[a-z0-9][a-z0-9._-]*|[㐀-鿿豈-﫿]+/g) ?? [];
  for (const t of tokens) {
    if (!CJK.test(t)) { out.push(t); continue; }
    if (t.length === 1) { out.push(t); continue; }
    for (let i = 0; i + 1 < t.length; i++) out.push(t.slice(i, i + 2));
  }
  return out;
}
const gramText = (t) => toGrams(t).join(" ");
// FTS5 的 MATCH 表达式：每个 gram 加引号防止被当成语法符号
const gramQuery = (q) => {
  const g = [...new Set(toGrams(q))];
  return g.length ? g.map((x) => `"${x.replace(/"/g, "")}"`).join(" OR ") : null;
};

// ---------- 知识库 ----------
export function listDocs() {
  return handle().prepare("SELECT * FROM documents ORDER BY updatedAt DESC").all()
    .map((d) => ({ ...d, tags: JSON.parse(d.tags || "[]") }));
}
export function upsertDoc(doc) {
  handle().prepare(`INSERT OR REPLACE INTO documents
    (id,title,sourceName,mime,category,tags,summary,charCount,chunkCount,createdAt,updatedAt)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
    doc.id, doc.title, doc.sourceName ?? null, doc.mime ?? null, doc.category ?? "other",
    JSON.stringify(doc.tags ?? []), doc.summary ?? null, doc.charCount ?? 0, doc.chunkCount ?? 0,
    doc.createdAt ?? Date.now(), doc.updatedAt ?? Date.now());
  return doc.id;
}
export function deleteDoc(docId) {
  const db = handle();
  const ids = db.prepare("SELECT id FROM chunks WHERE docId = ?").all(docId).map((r) => r.id);
  dropFts(ids);
  db.prepare("DELETE FROM chunks WHERE docId = ?").run(docId);
  db.prepare("DELETE FROM documents WHERE id = ?").run(docId);
  return ids.length;
}
function dropFts(chunkIds) {
  const stmt = handle().prepare("DELETE FROM chunks_fts WHERE chunkId = ?");
  for (const id of chunkIds) stmt.run(id);
}
export function insertChunks(docId, chunks) {
  const db = handle();
  db.exec("BEGIN");
  try {
    const ins = db.prepare("INSERT OR REPLACE INTO chunks (id,docId,seq,heading,category,text,createdAt) VALUES (?,?,?,?,?,?,?)");
    const delFts = db.prepare("DELETE FROM chunks_fts WHERE chunkId = ?");
    const fts = db.prepare("INSERT INTO chunks_fts (chunkId, gram) VALUES (?, ?)");
    for (const c of chunks) {
      ins.run(c.id, docId, c.seq, c.heading ?? null, c.category ?? "other", c.text, Date.now());
      delFts.run(c.id); // 重新导入同一块时先清旧索引，避免同一 chunkId 命中两次
      fts.run(c.id, gramText(`${c.heading ?? ""} ${c.text}`));
    }
    db.prepare("UPDATE documents SET chunkCount = (SELECT COUNT(*) FROM chunks WHERE docId = ?), updatedAt = ? WHERE id = ?")
      .run(docId, Date.now(), docId);
    db.exec("COMMIT");
  } catch (e) { db.exec("ROLLBACK"); throw e; }
  return chunks.length;
}
/** 全量切片。知识体系图要按 40 条主题逐条判命中，逐个搜 40 轮太浪费，一次取回在内存里算。 */
export function listChunks() {
  return handle().prepare("SELECT id, docId, heading, category, text FROM chunks ORDER BY docId, seq").all();
}

/** 返回 [{chunkId, docId, title, category, heading, text, score}]，score 越大越相关（SQLite bm25 是负数，取反） */
export function searchChunks(query, { limit = 6, category } = {}) {
  const m = gramQuery(query);
  if (!m) return [];
  const db = handle();
  const rows = db.prepare(`
    SELECT c.id AS chunkId, c.docId, c.heading, c.category, c.text, d.title, bm25(chunks_fts) AS raw
    FROM chunks_fts
    JOIN chunks c ON c.id = chunks_fts.chunkId
    JOIN documents d ON d.id = c.docId
    WHERE chunks_fts MATCH ? ${category ? "AND c.category = ?" : ""}
    ORDER BY raw LIMIT ?`).all(...(category ? [m, category, limit] : [m, limit]));
  return rows.map((r) => ({ ...r, score: -r.raw }));
}

// ---------- 看板 ----------
const TASK_COLS = ["id","kind","title","materialCode","materialName","supplier","poNo","qty","needDate","promiseDate","dueDate",
  "stage","status","score","reasons","steps","doneSteps","doneRule","escalation","sourceRow","note","bizDate","createdAt","updatedAt","closedAt"];
const JSON_COLS = new Set(["reasons","steps","doneSteps","sourceRow"]);
const encTask = (t) => TASK_COLS.map((c) => {
  const v = t[c];
  if (JSON_COLS.has(c)) return JSON.stringify(v ?? (c === "sourceRow" ? {} : []));
  return v === undefined ? null : v;
});
const decTask = (r) => { const o = { ...r }; for (const c of JSON_COLS) { try { o[c] = JSON.parse(r[c] ?? "null"); } catch { o[c] = null; } } return o; };

export function listTasks({ bizDate, includeClosed = true } = {}) {
  const db = handle();
  const where = [];
  const args = [];
  if (bizDate) { where.push("bizDate <= ?"); args.push(bizDate); }
  if (!includeClosed) where.push("status != 'done'");
  const sql = `SELECT * FROM board_tasks ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY score DESC, dueDate ASC`;
  return db.prepare(sql).all(...args).map(decTask);
}
export function upsertTasks(tasks) {
  const db = handle();
  const stmt = db.prepare(`INSERT OR REPLACE INTO board_tasks (${TASK_COLS.join(",")}) VALUES (${TASK_COLS.map(() => "?").join(",")})`);
  db.exec("BEGIN");
  try { for (const t of tasks) stmt.run(...encTask(t)); db.exec("COMMIT"); }
  catch (e) { db.exec("ROLLBACK"); throw e; }
  return tasks.length;
}
export function updateTask(id, patch) {
  const cur = handle().prepare("SELECT * FROM board_tasks WHERE id = ?").get(id);
  if (!cur) return 0;
  upsertTasks([{ ...decTask(cur), ...patch, updatedAt: Date.now() }]);
  return 1;
}
export function deleteTasks(ids) {
  const stmt = handle().prepare("DELETE FROM board_tasks WHERE id = ?");
  for (const id of ids) stmt.run(id);
  return ids.length;
}
export function getDay(bizDate) {
  const r = handle().prepare("SELECT * FROM board_days WHERE bizDate = ?").get(bizDate);
  return r ? { ...r, checklist: JSON.parse(r.checklist || "{}") } : { bizDate, checklist: {}, closedAt: null, note: null };
}
export function setDay(day) {
  handle().prepare("INSERT OR REPLACE INTO board_days (bizDate, checklist, closedAt, note) VALUES (?,?,?,?)")
    .run(day.bizDate, JSON.stringify(day.checklist ?? {}), day.closedAt ?? null, day.note ?? null);
  return day.bizDate;
}

// ---------- 学习计划 ----------
export function listProgress() {
  return handle().prepare("SELECT * FROM learning_progress").all();
}
export function setProgress(p) {
  handle().prepare(`INSERT OR REPLACE INTO learning_progress (itemId,status,score,note,startedAt,doneAt,updatedAt) VALUES (?,?,?,?,?,?,?)`)
    .run(p.itemId, p.status ?? "todo", p.score ?? null, p.note ?? null, p.startedAt ?? null, p.doneAt ?? null, Date.now());
  return p.itemId;
}
