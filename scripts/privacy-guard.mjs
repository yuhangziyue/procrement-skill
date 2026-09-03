// 隐私守卫：扫描将进仓 / 进产物的源码与知识文件，命中禁入词直接失败。
// 禁入词 = 供应商实名 / 真人姓名 / 客户品牌 / 私有文件名。故意写成拆开的字符串拼接，避免守卫脚本自己命中自己。
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const banned = [
  ["黄", "工印刷"], ["时", "进新材料"], ["马", "美娟"], ["美", "娟"], ["大", "统华"], ["沃", "尔玛"], ["子", "曰"],
  ["my-", "materials"], ["mentee-", "mameijuan"], ["caigou-", "order"],
].map((parts) => parts.join(""));

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
}
roots.forEach(walk);

if (hits.length) {
  console.error("❌ 隐私守卫拦截：以下文件含禁入词，不能进仓/发布\n" + hits.join("\n"));
  process.exit(1);
}
console.log("✅ 隐私守卫通过");
