// 文档导入：解析 → 切块 → 归类 → 写进桌面版 SQLite（documents + chunks + FTS5）。
//
// 设计取舍：
//   - 只在桌面版可用。网页版没有本地数据库，与其半残地存到 IndexedDB 再搜不动，不如直接给一句人话拒绝。
//   - 重解析器（xlsx / mammoth / pdfjs）一律 await import() 懒加载，不进主包——网页版用户永远加载不到它们。
//   - 报错只说人话：文件太大、扫描件没文字层、PDF 加密…… 原始英文异常只留在 console，不糊到用户脸上。
//   - 解码回退（UTF-8 严格 → GB18030）抄的是 src/db/materials.ts 的老写法；这里刻意不 import 它，
//     免得 knowledge/ 反向依赖 db/schema.ts（Dexie），让这一层保持纯粹、好测。
import Papa from "papaparse";
import { desktop, isDesktop } from "../data/bridge";
import { newId } from "../util/id";
import { chunk, type Chunk } from "./chunk";
import { classify, majorityCategory, type CategoryId } from "./classify";

export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const SUPPORTED_EXTS = ["md", "markdown", "txt", "csv", "xlsx", "xls", "docx", "pdf"] as const;
const EXT_LABEL = SUPPORTED_EXTS.map((e) => `.${e}`).join(" / ");

export interface IngestResult {
  docId: string;
  title: string;
  category: CategoryId;
  /** 入库块数 */
  chunks: number;
  charCount: number;
  /** 不阻塞导入、但值得让用户知道的提示（中文） */
  warnings: string[];
}

export interface ExtractResult {
  text: string;
  warnings: string[];
}

export const extOf = (name: string): string => (name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "");

/** UTF-8 严格解码，失败退 GB18030（中文 Windows 上导出的 CSV/TXT 多半是 GBK） */
export function decodeText(buf: ArrayBuffer): { text: string; fallback: boolean } {
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(buf), fallback: false };
  } catch {
    try {
      return { text: new TextDecoder("gb18030").decode(buf), fallback: true };
    } catch {
      return { text: new TextDecoder().decode(buf), fallback: true };
    }
  }
}

type Row = Record<string, string>;

/** 表格行 → 「列名: 值」文本；一行一段，切块时不会被拦腰截断 */
export function rowsToText(rows: Row[]): string {
  const out: string[] = [];
  for (const r of rows) {
    const cells = Object.entries(r)
      .filter(([k, v]) => k.trim() && String(v ?? "").trim())
      .map(([k, v]) => `${k.trim()}: ${String(v).trim()}`);
    if (cells.length) out.push(cells.join(" | "));
  }
  return out.join("\n\n");
}

const stripBom = (s: string) => (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s);

export function csvToText(text: string): string {
  const res = Papa.parse<Record<string, unknown>>(stripBom(text), {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim(),
  });
  const rows: Row[] = res.data.map((raw) => {
    const o: Row = {};
    for (const [k, v] of Object.entries(raw)) {
      if (!k || k === "__parsed_extra") continue;
      o[k] = v == null ? "" : String(v).trim();
    }
    return o;
  });
  return rowsToText(rows);
}

/** 二维矩阵 → 行对象：第一个非空行当表头 */
function matrixToRows(matrix: unknown[][]): Row[] {
  const cell = (v: unknown) => (v == null ? "" : String(v).trim());
  const grid = matrix.map((r) => (r ?? []).map(cell));
  const headIdx = grid.findIndex((r) => r.some((c) => c !== ""));
  if (headIdx < 0) return [];
  const headers = grid[headIdx].map((h, i) => h || `列${i + 1}`);
  const out: Row[] = [];
  for (const r of grid.slice(headIdx + 1)) {
    const o: Row = {};
    headers.forEach((h, i) => (o[h] = r[i] ?? ""));
    if (Object.values(o).some((v) => v !== "")) out.push(o);
  }
  return out;
}

async function xlsxToText(buf: ArrayBuffer): Promise<ExtractResult> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(buf, { type: "array", cellDates: true });
  const parts: string[] = [];
  for (const name of wb.SheetNames) {
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, raw: false, defval: "" });
    const body = rowsToText(matrixToRows(matrix));
    // 工作表名当二级标题，切块时会进 heading，搜出来能看出这条来自哪张表
    if (body) parts.push(`## ${name}\n\n${body}`);
  }
  const warnings: string[] = [];
  if (wb.SheetNames.length > 1) warnings.push(`这个表有 ${wb.SheetNames.length} 个工作表，都读进来了。`);
  if (!parts.length && wb.SheetNames.length) warnings.push("工作表都是空的，或者内容全在图片/图表里。");
  return { text: parts.join("\n\n"), warnings };
}

async function docxToText(buf: ArrayBuffer): Promise<ExtractResult> {
  const mod = await import("mammoth");
  const mammoth = ((mod as unknown as { default?: typeof mod }).default ?? mod) as typeof mod;
  const res = await mammoth.extractRawText({ arrayBuffer: buf });
  const warnings: string[] = [];
  if (res.messages?.length) warnings.push("文档里的图片、批注、复杂表格样式没有导入，只取了文字。");
  return { text: res.value ?? "", warnings };
}

/**
 * pdf.js 的 worker 地址。
 * 坑：不能用 CDN（离线桌面版直接废），也不能写 `new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url)`
 * ——Vite 对 new URL() 里的「裸包名」不做解析，产物里会原样保留，file:// 下必然 404。
 * 正确姿势是让 Vite 自己解析：优先 ?worker（Vite 生成 Worker 构造器，file:// 下最稳），
 * 退一步用 ?url（Vite 把 worker 作为独立资源产出并回填最终地址，内部同样是 import.meta.url 相对定位）。
 */
async function setupPdfWorker(pdfjs: typeof import("pdfjs-dist")): Promise<void> {
  if (pdfjs.GlobalWorkerOptions.workerPort || pdfjs.GlobalWorkerOptions.workerSrc) return;
  try {
    const { default: PdfWorker } = await import("pdfjs-dist/build/pdf.worker.min.mjs?worker");
    pdfjs.GlobalWorkerOptions.workerPort = new PdfWorker();
  } catch {
    const { default: url } = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
    pdfjs.GlobalWorkerOptions.workerSrc = url;
  }
}

async function pdfToText(buf: ArrayBuffer): Promise<ExtractResult> {
  const pdfjs = await import("pdfjs-dist");
  await setupPdfWorker(pdfjs);
  let doc: Awaited<ReturnType<typeof pdfjs.getDocument>["promise"]>;
  try {
    doc = await pdfjs.getDocument({ data: new Uint8Array(buf), isEvalSupported: false }).promise;
  } catch (err) {
    console.error("[kb] pdf 打开失败", err);
    const name = (err as { name?: string })?.name ?? "";
    if (name === "PasswordException") throw new Error("这份 PDF 有密码保护，读不了。请先用能打开它的软件另存一份不带密码的再导入。");
    if (name === "InvalidPDFException") throw new Error("这份 PDF 打不开，文件可能损坏或者其实不是 PDF。用阅读器打开确认一下，或者让对方重发一次。");
    throw new Error("这份 PDF 解析失败了。可以试着用阅读器「另存为」一份新的 PDF 再导入。");
  }
  const parts: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    let line = "";
    const lines: string[] = [];
    for (const item of content.items) {
      if (!("str" in item)) continue;
      line += item.str;
      if (item.hasEOL) {
        lines.push(line);
        line = "";
      }
    }
    if (line) lines.push(line);
    const body = lines.map((l) => l.trim()).filter(Boolean).join("\n");
    if (body) parts.push(body);
  }
  await doc.destroy();
  const warnings: string[] = [];
  if (parts.length && parts.length < doc.numPages) warnings.push(`共 ${doc.numPages} 页，其中 ${doc.numPages - parts.length} 页没有文字（多半是图片页）。`);
  return { text: parts.join("\n\n"), warnings };
}

/** 文件 → 纯文本。不落库，面板做预览也能用。 */
export async function extractText(file: File, ext = extOf(file.name)): Promise<ExtractResult> {
  const buf = await file.arrayBuffer();
  if (ext === "xlsx" || ext === "xls") return xlsxToText(buf);
  if (ext === "docx") return docxToText(buf);
  if (ext === "pdf") return pdfToText(buf);
  const { text, fallback } = decodeText(buf);
  const warnings = fallback ? ["文件不是 UTF-8，按 GB18030（GBK）解码的；要是看到乱码，用记事本另存为 UTF-8 再导一次。"] : [];
  if (ext === "csv") return { text: csvToText(text), warnings };
  return { text, warnings };
}

/** 去掉 Markdown 记号，取第一句话 */
function firstSentence(text: string): string {
  const flat = text
    .split("\n")
    .map((l) => l.replace(/^\s*[#>*\-+]+\s*/, "").replace(/^\s*\d+[.、)]\s*/, "").replace(/[|*`]/g, "").trim())
    .filter(Boolean)
    .join("");
  const m = flat.match(/^[^。！？!?\n]{1,120}[。！？!?]?/);
  return (m?.[0] ?? flat.slice(0, 120)).trim();
}

/** 文档摘要：拼前几块的首句，30–80 字，不调模型 */
export function summarize(chunks: Pick<Chunk, "text">[], min = 30, max = 80): string {
  let s = "";
  for (const c of chunks.slice(0, 6)) {
    const first = firstSentence(c.text);
    if (!first) continue;
    s += first;
    if (s.length >= min) break;
  }
  if (s.length > max) s = `${s.slice(0, max - 1)}…`;
  return s;
}

/** 标题：优先文档里第一个 Markdown 一级/二级标题，否则用文件名（去扩展名） */
export function titleOf(fileName: string, text: string): string {
  const h = text.match(/^\s{0,3}#{1,2}\s+(.+?)\s*#*\s*$/m)?.[1]?.trim();
  if (h && h.length <= 60) return h;
  return fileName.replace(/\.[^.]+$/, "").trim() || fileName;
}

const mb = (n: number) => (n / 1024 / 1024).toFixed(1);

/**
 * 导入一份文档：解析 → 切块 → 逐块归类 → 写库。
 * 出错一律抛中文 Error，面板直接把 message 显示给用户。
 */
export async function ingestFile(file: File): Promise<IngestResult> {
  if (!isDesktop()) throw new Error("文档知识库是桌面版功能。网页版没有本地数据库，存不下导入的文档，请在小采桌面版里导入。");

  const ext = extOf(file.name);
  if (!(SUPPORTED_EXTS as readonly string[]).includes(ext))
    throw new Error(`还读不了「${file.name}」这种格式。目前支持：${EXT_LABEL}。如果是 .doc / .ppt，先另存成 .docx / .pdf 再导。`);
  if (file.size === 0) throw new Error(`「${file.name}」是空文件（0 字节），没有内容可以导入。`);
  if (file.size > MAX_FILE_BYTES)
    throw new Error(`「${file.name}」有 ${mb(file.size)} MB，超过 5 MB 上限。先把它拆成几份，或者删掉里面的图片、附件再导。`);

  let extracted: ExtractResult;
  try {
    extracted = await extractText(file, ext);
  } catch (err) {
    // pdfToText 等已经抛中文了，原样透出；其余的兜一层人话
    if (err instanceof Error && /[一-龥]/.test(err.message)) throw err;
    console.error("[kb] 解析失败", err);
    throw new Error(`「${file.name}」解析失败了，文件可能损坏或者格式和扩展名对不上。换个格式另存一份再试试。`);
  }

  const text = extracted.text.replace(/\u0000/g, "").trim();
  if (!text) {
    if (ext === "pdf") throw new Error("这份 PDF 里没有可以复制的文字，应该是扫描件（图片版）。得先做 OCR 转成文字，或者找一份原始的 Word / Excel 来导。");
    if (ext === "xlsx" || ext === "xls") throw new Error("这个表格里没读到文字内容，可能是空表，或者内容都在图片、图表里。");
    throw new Error(`「${file.name}」里没读到任何文字内容。确认一下文件是不是空的。`);
  }

  const chunks = chunk(text);
  if (!chunks.length) throw new Error(`「${file.name}」里没有能切成知识块的正文。`);

  const scored = chunks.map((c) => ({ ...c, ...classify(c.text, c.heading) }));
  const category = majorityCategory(scored);
  const tags = [...new Set(scored.map((s) => s.category))].filter((c) => c !== "other" && c !== category);
  const docId = newId();
  const now = Date.now();

  await desktop().call("kb.upsertDoc", {
    id: docId,
    title: titleOf(file.name, text),
    sourceName: file.name,
    mime: file.type || ext,
    category,
    tags,
    summary: summarize(chunks),
    charCount: text.length,
    chunkCount: chunks.length,
    createdAt: now,
    updatedAt: now,
  });
  await desktop().call(
    "kb.insertChunks",
    docId,
    scored.map((s) => ({ id: newId(), seq: s.seq, heading: s.heading, category: s.category, text: s.text })),
  );

  return {
    docId,
    title: titleOf(file.name, text),
    category,
    chunks: chunks.length,
    charCount: text.length,
    warnings: extracted.warnings,
  };
}
