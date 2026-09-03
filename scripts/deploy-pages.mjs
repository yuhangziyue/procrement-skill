// 把 dist/ 推到 gh-pages 分支（orphan，只含产物），供 GitHub Pages「Deploy from a branch: gh-pages /(root)」发布。
//
// 为什么走分支而不是 Actions Source（参考 life-os 2026-08-24 的实证）：
//   Pages 的 Source 只能由仓库 owner 在 Settings 里点；GITHUB_TOKEN 无权创建站点（2026-09-03 configure-pages enablement 实测失败）。
//   而 gh-pages 分支是 GitHub 认识多年的约定，产物直接可发布，对 Source 设置的依赖最小。
//
// 用法：npm run deploy:pages   （内部：build → 产物门禁 → 推 gh-pages）
// CI 也调本脚本（.github/workflows/deploy.yml），本地与 CI 同一条链路，不会漂。
import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = process.cwd();
const dist = join(root, "dist");
const sh = (cmd, opts = {}) => execSync(cmd, { stdio: "inherit", ...opts });
const out = (cmd, opts = {}) => execSync(cmd, { encoding: "utf8", ...opts }).trim();
const fail = (m) => { console.error(`\n✗ ${m}\n`); process.exit(1); };

// ---- 产物门禁：缺 index.html / 主 js 明显偏小 都不发 ----
if (!existsSync(join(dist, "index.html"))) fail("dist/index.html 不存在，先 npm run build");
const assets = join(dist, "assets");
const mainJs = existsSync(assets) ? readdirSync(assets).find((f) => /^index-.*\.js$/.test(f)) : undefined;
if (!mainJs) fail("dist/assets 里找不到 index-*.js");
const size = statSync(join(assets, mainJs)).size;
if (size < 200_000) fail(`主 js 只有 ${size} 字节，构建大概率不完整（正常 ≈ 700KB）`);
writeFileSync(join(dist, ".nojekyll"), ""); // 让 Pages 原样发布 _ 开头等路径

const sha = out("git rev-parse --short HEAD");
const remote = process.env.PAGES_REMOTE || "origin";
const wt = mkdtempSync(join(tmpdir(), "xiaocai-ghp-"));
try {
  sh(`git worktree add --detach "${wt}" HEAD`, { stdio: "ignore" });
  sh(`git -C "${wt}" checkout --orphan gh-pages -q`);
  execSync(`git -C "${wt}" rm -rfq .`, { stdio: "ignore" });
  sh(`cp -R "${dist}/." "${wt}/"`);
  sh(`git -C "${wt}" add -A`);
  const author = process.env.GITHUB_ACTIONS ? `-c user.name=github-actions[bot] -c user.email=41898282+github-actions[bot]@users.noreply.github.com` : "";
  sh(`git ${author} -C "${wt}" commit -q -m "deploy: ${sha} 产物（${mainJs}）"`);
  sh(`git -C "${wt}" push -f -q ${remote} gh-pages`);
  console.log(`\n✅ gh-pages 已更新 ← master ${sha}（${mainJs}, ${size} bytes）`);
} finally {
  execSync(`git worktree remove --force "${wt}"`, { stdio: "ignore" });
  rmSync(wt, { recursive: true, force: true });
}
