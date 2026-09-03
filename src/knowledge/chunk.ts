// 文档切块：纯函数、零 IO，供 ingest.ts 在导入时调用，也可单测。
//
// 切法（优先级从高到低）：
//   1) Markdown 标题（# ~ ######）划分「节」，节内再按空行分段；标题链写进 heading，如「采购制度 > 请购流程」
//   2) 段落贪心打包到目标长度（400–800 字），硬上限 1200 字
//   3) 超长段落先按行拆（表格 / 列表不至于被腰斩），行还超长再按句号分号拆，最后才硬切
//   4) 不足 80 字的碎块向后合并；跨节合并时 heading 退到两者的公共祖先，并把子标题以「【子标题】」写进正文，
//      免得合并后正文丢掉它自己的上下文
//
// 长度一律按「字符数」算（中文 1 字 = 1）。

export interface Chunk {
  /** 文档内序号，从 0 开始 */
  seq: number;
  /** 标题链，如「采购制度 > 请购流程」；无标题的文档为空串 */
  heading: string;
  text: string;
}

export interface ChunkLimits {
  /** 低于这个长度时，宁可超过 target 也要继续塞（避免一堆 100 字的碎块） */
  soft: number;
  /** 目标块长上限 */
  target: number;
  /** 硬上限，任何块都不许超过 */
  max: number;
  /** 低于这个长度视为碎块，向后合并 */
  min: number;
}

export const DEFAULT_LIMITS: ChunkLimits = { soft: 400, target: 800, max: 1200, min: 80 };

const HEADING_RE = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const FENCE_RE = /^\s*(```|~~~)/;
/** 句末：中文句号叹号问号分号，以及英文句点后跟空白 */
const SENTENCE_RE = /(?<=[。！？；;!?])|(?<=\.)(?=\s)/;
/** 退而求其次的切点：逗号顿号 */
const CLAUSE_RE = /(?<=[，,、])/;

export interface Section {
  /** 标题链，空串表示文档开头无标题的部分 */
  heading: string;
  body: string;
}

/** 按 Markdown 标题切节；代码围栏内的 # 不算标题。无标题时返回单节。 */
export function splitSections(input: string): Section[] {
  const text = String(input ?? "").replace(/\r\n?/g, "\n");
  const stack: string[] = [];
  const sections: Section[] = [];
  let heading = "";
  let buf: string[] = [];
  let inFence = false;

  const flush = () => {
    const body = buf.join("\n").trim();
    if (body) sections.push({ heading, body });
    buf = [];
  };

  for (const line of text.split("\n")) {
    if (FENCE_RE.test(line)) inFence = !inFence;
    const m = inFence ? null : HEADING_RE.exec(line);
    if (!m) {
      buf.push(line);
      continue;
    }
    flush();
    const level = m[1].length;
    stack.length = Math.min(stack.length, level - 1);
    while (stack.length < level - 1) stack.push("");
    stack[level - 1] = m[2].trim();
    heading = stack.filter(Boolean).join(" > ");
  }
  flush();
  return sections;
}

/** 把一段文本切成每段都 ≤ max 的句子单元；无标点的超长串最后硬切。 */
export function splitSentences(text: string, max = DEFAULT_LIMITS.max): string[] {
  const out: string[] = [];
  const push = (s: string) => {
    const t = s.trim();
    if (!t) return;
    if (t.length <= max) {
      out.push(t);
      return;
    }
    // 句号切不动 ⇒ 退到逗号
    const clauses = t.split(CLAUSE_RE).map((x) => x.trim()).filter(Boolean);
    if (clauses.length > 1) {
      for (const c of clauses) push(c);
      return;
    }
    // 通篇没有标点（英文长串 / 代码），只能硬切
    for (let i = 0; i < t.length; i += max) out.push(t.slice(i, i + max));
  };
  for (const s of text.split(SENTENCE_RE)) push(s);
  return out;
}

/** 贪心打包：优先不超过 target；当前块还没到 soft 就允许撑到 max，免得留下半截块。 */
function packUnits(units: string[], limits: ChunkLimits, joiner: string): string[] {
  const out: string[] = [];
  let cur = "";
  for (const u of units) {
    if (!u) continue;
    if (!cur) {
      cur = u;
      continue;
    }
    const merged = cur.length + joiner.length + u.length;
    if (merged <= limits.target || (cur.length < limits.soft && merged <= limits.max)) cur += joiner + u;
    else {
      out.push(cur);
      cur = u;
    }
  }
  if (cur) out.push(cur);
  return out;
}

/** 一个段落 → 若干 ≤ max 的单元。超长段落先按行拆（保住表格/列表的行结构），再按句子拆。 */
function paragraphUnits(para: string, limits: ChunkLimits): string[] {
  if (para.length <= limits.max) return [para];
  const lines = para.split("\n").map((l) => l.trimEnd()).filter((l) => l.trim());
  if (lines.length > 1) {
    const flat = lines.flatMap((l) => (l.length <= limits.max ? [l] : splitSentences(l, limits.max)));
    return packUnits(flat, limits, "\n");
  }
  return packUnits(splitSentences(para, limits.max), limits, "");
}

interface Piece {
  heading: string;
  text: string;
}

/** 两条标题链的公共祖先，如「A > B > C」与「A > B > D」→「A > B」 */
function commonHeading(a: string, b: string): string {
  if (a === b) return a;
  const x = a ? a.split(" > ") : [];
  const y = b ? b.split(" > ") : [];
  const keep: string[] = [];
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    if (x[i] !== y[i]) break;
    keep.push(x[i]);
  }
  return keep.join(" > ");
}

const leafOf = (h: string) => (h ? h.split(" > ").pop()! : "");

function mergeTwo(a: Piece, b: Piece): Piece {
  const heading = commonHeading(a.heading, b.heading);
  // 跨节合并：把被并进来那节的标题写进正文，否则合并后这段话就没头没尾了
  const label = a.heading === b.heading ? "" : leafOf(b.heading) ? `【${leafOf(b.heading)}】\n` : "";
  return { heading, text: `${a.text}\n\n${label}${b.text}` };
}

/** 碎块（< min）向后合并；末尾的碎块并回上一块。放不下（会破 max）就保留原样。 */
function mergeShort(pieces: Piece[], limits: ChunkLimits): Piece[] {
  const out: Piece[] = [];
  let carry: Piece | undefined;
  for (const p of pieces) {
    let cur = p;
    if (carry) {
      if (carry.text.length + cur.text.length + 2 <= limits.max) cur = mergeTwo(carry, cur);
      else out.push(carry);
      carry = undefined;
    }
    if (cur.text.length < limits.min) carry = cur;
    else out.push(cur);
  }
  if (carry) {
    const last = out[out.length - 1];
    if (last && last.text.length + carry.text.length + 2 <= limits.max) out[out.length - 1] = mergeTwo(last, carry);
    else out.push(carry);
  }
  return out;
}

/** 文本 → 块。空输入返回 []。 */
export function chunk(input: string, opts: Partial<ChunkLimits> = {}): Chunk[] {
  const limits: ChunkLimits = { ...DEFAULT_LIMITS, ...opts };
  const pieces: Piece[] = [];
  for (const sec of splitSections(input)) {
    const paras = sec.body.split(/\n[ \t]*\n+/).map((p) => p.trim()).filter(Boolean);
    const units = paras.flatMap((p) => paragraphUnits(p, limits));
    for (const text of packUnits(units, limits, "\n\n")) pieces.push({ heading: sec.heading, text });
  }
  return mergeShort(pieces, limits).map((p, seq) => ({ seq, heading: p.heading, text: p.text }));
}
