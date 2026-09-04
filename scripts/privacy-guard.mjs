// 隐私守卫：扫描将进仓 / 进产物的源码与知识文件，命中禁入词直接失败。
// 禁入词 = 供应商实名 / 真人姓名 / 客户品牌 / 私有文件名。故意写成拆开的字符串拼接，避免守卫脚本自己命中自己。
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const banned = [
  ["黄", "工印刷"], ["时", "进新材料"], ["马", "美娟"], ["美", "娟"], ["大", "统华"], ["沃", "尔玛"], ["子", "曰"],
  ["my-", "materials"], ["mentee-", "mameijuan"], ["caigou-", "order"],
].map((parts) => parts.join(""));

// 真实 API Key 绝不能进源码。内置 Key 的正确做法是打包时从 gitignore 掉的 .env.local 注入
// （见 vite.config.ts 的 bundledKey），源码里出现 ark-xxxx 一律拦下——公开仓 + git 历史撤不干净。
const ARK_KEY_RE = /\bark-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b|\bsk-[A-Za-z0-9]{20,}\b/;


const roots = ["src", "knowledge", "templates", "proxy", "index.html", "README.md"];
const exts = new Set([".ts", ".tsx", ".js", ".mjs", ".json", ".md", ".csv", ".html", ".css", ".txt", ".toml", ".yml"]);
const hits = [];

function walk(p) {
  let st;
  try { st = statSync(p); } catch { return; }
  if (st.isDirectory()) return readdirSync(p).forEach((f) => walk(join(p, f)));
  if (!exts.has(extname(p))) return;
  const text = readFileSync(p, "utf8");
  for (const w of banned) if (text.includes(w)) hits.push(`${p}: 命中「${w}」`);
  const key = text.match(ARK_KEY_RE);
  if (key) hits.push(`${p}: 源码里出现 API Key（${key[0].slice(0, 12)}…）—— Key 只能放 .env.local，由 vite 在桌面版打包时注入`);
}
roots.forEach(walk);

if (hits.length) {
  console.error("❌ 隐私守卫拦截：以下文件含禁入词，不能进仓/发布\n" + hits.join("\n"));
  process.exit(1);
}
console.log("✅ 隐私守卫通过");
