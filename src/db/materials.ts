// 资料库：CSV / XLSX 解析、角色识别、版本差异、导入落库。
// 纯函数（parseCsv / rowsFromMatrix / detectRole / diffRows）不碰 IndexedDB，可单测；带 db 的函数只在浏览器里跑。
import Papa from "papaparse";
import { db, type MaterialRow } from "./schema";
import { newId } from "../util/id";

export type MaterialRole = MaterialRow["role"];
export type Row = Record<string, string>;

export const ROLE_LABELS: Record<MaterialRole, string> = {
  materials: "物料表",
  tracking: "跟单表",
  suppliers: "供应商档案",
  doc: "其他文档",
};

/** 各角色做差异比对时的主键列；undefined = 该角色不做逐行比对 */
export const ROLE_KEY_FIELDS: Record<MaterialRole, string[] | undefined> = {
  materials: ["存货编码"],
  tracking: ["订单号", "物料编码"],
  suppliers: ["字段"],
  doc: undefined,
};

/** 各角色里代表「状态」的列，用于「状态变化 N」的摘要 */
export const ROLE_STATUS_FIELD: Partial<Record<MaterialRole, string>> = {
  materials: "采购状态",
  tracking: "状态",
};

const stripBom = (s: string) => (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s);

function normalizeRow(raw: Record<string, unknown>): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(raw)) {
    const key = k.trim();
    if (!key || key === "__parsed_extra") continue;
    out[key] = v == null ? "" : String(v).trim();
  }
  return out;
}

const isBlankRow = (r: Row) => Object.values(r).every((v) => v === "");

/** 解析 CSV 文本：首行为表头，去 BOM，列名 trim，跳过空行 */
export function parseCsv(text: string): Row[] {
  const res = Papa.parse<Record<string, unknown>>(stripBom(text), {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim(),
  });
  return res.data.map(normalizeRow).filter((r) => !isBlankRow(r));
}

/**
 * 把二维单元格矩阵变成对象行。表头行的选法：优先第一行含「字段」单元格的行（供应商档案模板前几行是说明行），
 * 否则取第一个非空行。
 */
export function rowsFromMatrix(matrix: unknown[][]): Row[] {
  const cell = (v: unknown) => (v == null ? "" : String(v).trim());
  const rows = matrix.map((r) => (r ?? []).map(cell));
  let headerIdx = rows.findIndex((r) => r.some((c) => c.includes("字段")));
  if (headerIdx < 0) headerIdx = rows.findIndex((r) => r.some((c) => c !== ""));
  if (headerIdx < 0) return [];
  const headers = rows[headerIdx];
  const out: Row[] = [];
  for (const r of rows.slice(headerIdx + 1)) {
    const obj: Row = {};
    headers.forEach((h, i) => {
      if (h) obj[h] = r[i] ?? "";
    });
    if (!isBlankRow(obj)) out.push(obj);
  }
  return out;
}

/** 解析 XLSX：动态加载 SheetJS，只读第一个 sheet */
export async function parseXlsx(buf: ArrayBuffer): Promise<Row[]> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(buf, { type: "array", cellDates: true });
  const first = wb.SheetNames[0];
  if (!first) return [];
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[first], { header: 1, raw: false, defval: "" });
  return rowsFromMatrix(matrix);
}

/** 按列名猜资料角色；猜不出返回 undefined 让用户选 */
export function detectRole(headers: string[]): MaterialRole | undefined {
  const h = new Set(headers.map((x) => x.trim()));
  if (h.has("存货编码")) return "materials";
  if (h.has("订单号") && h.has("承诺交期")) return "tracking";
  if (h.has("字段") && [...h].some((x) => x.startsWith("示例"))) return "suppliers";
  return undefined;
}

export interface FieldChange {
  key: string;
  field: string;
  from: string;
  to: string;
}
export interface DiffResult {
  added: Row[];
  removed: Row[];
  changed: FieldChange[];
}

const rowKey = (r: Row, fields: string[]) => fields.map((f) => r[f] ?? "").join("|");

/** 两版行集按主键比对。keyField 可为单列或多列（跟单表 = 订单号+物料编码） */
export function diffRows(prev: Row[], next: Row[], keyField: string | string[]): DiffResult {
  const fields = Array.isArray(keyField) ? keyField : [keyField];
  const prevMap = new Map(prev.map((r) => [rowKey(r, fields), r]));
  const nextMap = new Map(next.map((r) => [rowKey(r, fields), r]));
  const added: Row[] = [];
  const removed: Row[] = [];
  const changed: FieldChange[] = [];
  for (const [k, n] of nextMap) {
    const p = prevMap.get(k);
    if (!p) {
      added.push(n);
      continue;
    }
    const cols = new Set([...Object.keys(p), ...Object.keys(n)]);
    for (const c of cols) {
      const from = p[c] ?? "";
      const to = n[c] ?? "";
      if (from !== to) changed.push({ key: k, field: c, from, to });
    }
  }
  for (const [k, p] of prevMap) if (!nextMap.has(k)) removed.push(p);
  return { added, removed, changed };
}

export interface DiffSummary {
  added: number;
  removed: number;
  /** 状态列发生变化的行数（没有状态列的角色 = 任意字段变化的行数） */
  statusChanged: number;
  /** 任意字段变化的行数 */
  rowsChanged: number;
}

export function summarizeDiff(diff: DiffResult, role: MaterialRole): DiffSummary {
  const statusField = ROLE_STATUS_FIELD[role];
  const rowsChanged = new Set(diff.changed.map((c) => c.key)).size;
  const statusChanged = statusField ? new Set(diff.changed.filter((c) => c.field === statusField).map((c) => c.key)).size : rowsChanged;
  return { added: diff.added.length, removed: diff.removed.length, statusChanged, rowsChanged };
}

/** 文件 → 文本。优先 UTF-8（严格），失败退 GB18030（Excel 在中文 Windows 上导出的 CSV 常是 GBK） */
export function decodeText(buf: ArrayBuffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    try {
      return new TextDecoder("gb18030").decode(buf);
    } catch {
      return new TextDecoder().decode(buf);
    }
  }
}

export function kindOf(filename: string): MaterialRow["kind"] {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  if (ext === "csv") return "csv";
  if (ext === "xlsx" || ext === "xls" || ext === "xlsm") return "xlsx";
  if (ext === "md" || ext === "markdown") return "md";
  return "txt";
}

export interface ParsedFile {
  kind: MaterialRow["kind"];
  rows?: Row[];
  text?: string;
  headers: string[];
}

/** 只解析、不落库。面板用它做角色识别预览 */
export async function parseMaterialFile(file: File): Promise<ParsedFile> {
  const kind = kindOf(file.name);
  const buf = await file.arrayBuffer();
  if (kind === "csv") {
    const rows = parseCsv(decodeText(buf));
    return { kind, rows, headers: headersOf(rows) };
  }
  if (kind === "xlsx") {
    const rows = await parseXlsx(buf);
    return { kind, rows, headers: headersOf(rows) };
  }
  return { kind, text: decodeText(buf), headers: [] };
}

export function headersOf(rows: Row[]): string[] {
  const set = new Set<string>();
  for (const r of rows.slice(0, 20)) for (const k of Object.keys(r)) set.add(k);
  return [...set];
}

export interface ImportResult {
  row: MaterialRow;
  /** 同 role 同名已有旧版时给出的差异；首次导入或该角色不做比对时为 undefined */
  diff?: DiffResult;
  summary?: DiffSummary;
  previousVersion?: number;
}

/**
 * 导入一份资料。同 role 同名已存在 ⇒ 新版本 version+1，旧版本保留元数据但清空 rows/rawBlob/text 省空间。
 * 返回新行与（若有）相对上一版的差异。
 */
export async function importMaterial(file: File, role: MaterialRole, name?: string): Promise<ImportResult> {
  const finalName = (name ?? file.name).trim() || file.name;
  const parsed = await parseMaterialFile(file);
  const prev = await latestByName(role, finalName);

  let diff: DiffResult | undefined;
  let summary: DiffSummary | undefined;
  const keyFields = ROLE_KEY_FIELDS[role];
  if (prev?.rows && parsed.rows && keyFields) {
    diff = diffRows(prev.rows, parsed.rows, keyFields);
    summary = summarizeDiff(diff, role);
  }

  const row: MaterialRow = {
    id: newId(),
    name: finalName,
    kind: parsed.kind,
    role,
    rawBlob: file,
    rows: parsed.rows,
    text: parsed.text,
    version: (prev?.version ?? 0) + 1,
    createdAt: Date.now(),
  };

  await db.transaction("rw", db.materials, async () => {
    if (prev) await db.materials.update(prev.id, { rows: undefined, rawBlob: undefined, text: undefined });
    await db.materials.add(row);
  });

  return { row, diff, summary, previousVersion: prev?.version };
}

async function latestByName(role: MaterialRole, name: string): Promise<MaterialRow | undefined> {
  const all = await db.materials.where("role").equals(role).filter((r) => r.name === name).toArray();
  return pickLatest(all);
}

function pickLatest(rows: MaterialRow[]): MaterialRow | undefined {
  return rows.reduce<MaterialRow | undefined>((best, r) => {
    if (!best) return r;
    if (r.version !== best.version) return r.version > best.version ? r : best;
    return r.createdAt > best.createdAt ? r : best;
  }, undefined);
}

/** 该角色下最新版本的一份（多份同角色资料时取版本最高、最近导入的） */
export async function getActiveMaterial(role: MaterialRole): Promise<MaterialRow | undefined> {
  const all = await db.materials.where("role").equals(role).toArray();
  const withData = all.filter((r) => r.rows || r.text || r.rawBlob);
  return pickLatest(withData.length ? withData : all);
}

/** 每个 (role, name) 的最新版本，供面板列表用 */
export async function listActiveMaterials(): Promise<MaterialRow[]> {
  const all = await db.materials.toArray();
  const groups = new Map<string, MaterialRow[]>();
  for (const r of all) {
    const k = `${r.role} ${r.name}`;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(r);
  }
  return [...groups.values()]
    .map((g) => pickLatest(g)!)
    .sort((a, b) => a.role.localeCompare(b.role) || b.createdAt - a.createdAt);
}

/** 删除一份资料的全部版本（按 role+name），否则删掉最新版后旧版会「复活」 */
export async function deleteMaterial(id: string): Promise<number> {
  const target = await db.materials.get(id);
  if (!target) return 0;
  const ids = (await db.materials.where("role").equals(target.role).filter((r) => r.name === target.name).toArray()).map((r) => r.id);
  await db.materials.bulkDelete(ids);
  return ids.length;
}
