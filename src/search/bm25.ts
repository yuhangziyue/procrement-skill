// 零依赖的本地 BM25 检索。给增强卡 / 资料库做「按意图召回」，全部在浏览器内存里跑，不出网。
// 分词：中文按字 bigram（单字 run 退化为单字），英文/数字按连续 token（小写）。

const K1 = 1.5;
const B = 0.75;

const HAN = /\p{Script=Han}/u;
const WORD = /[\p{L}\p{N}]/u;

/**
 * 「生产缺料 1100002 MOQ」→ ["生产","产缺","缺料","1100002","moq"]
 * 中文连续段切 bigram；其它字母/数字连续段整段为一个 token；标点空白全丢。
 */
export function tokenize(text: string): string[] {
  const out: string[] = [];
  let han = "";
  let word = "";
  const flushHan = () => {
    if (!han) return;
    const chars = Array.from(han);
    if (chars.length === 1) out.push(chars[0]);
    for (let i = 0; i + 1 < chars.length; i++) out.push(chars[i] + chars[i + 1]);
    han = "";
  };
  const flushWord = () => {
    if (word) out.push(word.toLowerCase());
    word = "";
  };
  for (const ch of text) {
    if (HAN.test(ch)) {
      flushWord();
      han += ch;
    } else if (WORD.test(ch)) {
      flushHan();
      word += ch;
    } else {
      flushHan();
      flushWord();
    }
  }
  flushHan();
  flushWord();
  return out;
}

export interface Bm25Hit<M = unknown> {
  id: string;
  score: number;
  meta?: M;
}

interface Doc<M> {
  tf: Map<string, number>;
  len: number;
  meta?: M;
}

export class Bm25Index<M = unknown> {
  private docs = new Map<string, Doc<M>>();
  private df = new Map<string, number>();
  private totalLen = 0;

  get size(): number {
    return this.docs.size;
  }

  /** 同一 id 重复 add 视为替换。 */
  add(id: string, text: string, meta?: M): void {
    if (this.docs.has(id)) this.remove(id);
    const tokens = tokenize(text);
    const tf = new Map<string, number>();
    for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
    for (const t of tf.keys()) this.df.set(t, (this.df.get(t) ?? 0) + 1);
    this.docs.set(id, { tf, len: tokens.length, meta });
    this.totalLen += tokens.length;
  }

  remove(id: string): boolean {
    const doc = this.docs.get(id);
    if (!doc) return false;
    for (const t of doc.tf.keys()) {
      const n = (this.df.get(t) ?? 0) - 1;
      if (n <= 0) this.df.delete(t);
      else this.df.set(t, n);
    }
    this.totalLen -= doc.len;
    this.docs.delete(id);
    return true;
  }

  /** 只返回 score > 0 的命中，按分数降序，最多 k 条。空索引 / 空查询 → []。 */
  search(query: string, k = 5): Bm25Hit<M>[] {
    const N = this.docs.size;
    if (N === 0 || k <= 0) return [];
    const qTokens = Array.from(new Set(tokenize(query)));
    if (qTokens.length === 0) return [];
    const avgLen = this.totalLen / N;

    const hits: Bm25Hit<M>[] = [];
    for (const [id, doc] of this.docs) {
      let score = 0;
      for (const t of qTokens) {
        const tf = doc.tf.get(t);
        if (!tf) continue;
        const df = this.df.get(t) ?? 0;
        const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
        const norm = K1 * (1 - B + (B * doc.len) / (avgLen || 1));
        score += idf * ((tf * (K1 + 1)) / (tf + norm));
      }
      if (score > 0) hits.push({ id, score, meta: doc.meta });
    }
    hits.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
    return hits.slice(0, k);
  }
}
