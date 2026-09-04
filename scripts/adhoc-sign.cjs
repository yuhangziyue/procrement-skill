// electron-builder 的 afterPack 钩子：给 .app 打临时（ad-hoc）签名。
//
// 为什么必须有：Apple Silicon 要求每个可执行文件都有有效签名，否则内核直接杀进程——
// 现象极具迷惑性：`open` 返回 0、没有任何报错、没有崩溃报告，app 就是起不来。
// electron-builder 配了 identity:null 时会完全跳过签名步骤，于是包里留着的是**原版 Electron 二进制的
// linker 签名**（codesign -dv 会显示 Identifier=Electron），而我们已经把 app.asar 换成自己的了，
// 签名与内容对不上 ⇒ 无效 ⇒ 被杀。
//
// 这里补一个 ad-hoc 签名（`--sign -`），自用足够；要发给别人仍需 Apple Developer 证书做公证，
// 否则对方首次打开要右键 → 打开。钩子跑在打 dmg 之前，所以 dmg 里的也是签好的。
const { execFileSync } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");

/**
 * 打包前置门禁：确认 dist/ 是「桌面版」构建，不是网页版。
 *
 * 2026-09-04 踩过：网页版构建 base 是 /procrement-skill/，资源路径写成绝对路径；
 * 打进 .app 后从 file:// 加载，会解析到**文件系统根目录** → 404 → 整个渲染层白屏，
 * 表现就是"工作台、知识库全都点不开"。而冒烟测试跑在打包前的 dist 上，正好照不到。
 * 根因是构建顺序：先 ELECTRON=1 build 过了冒烟，又跑了一次网页版 build 覆盖 dist，然后打包。
 * 这道门禁让这种事直接构建失败，而不是发到用户手里才发现。
 */
function assertDesktopBuild(root) {
  const html = fs.readFileSync(path.join(root, "dist", "index.html"), "utf8");
  const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]).filter((u) => !/^(https?:|data:|#)/.test(u));
  const absolute = refs.filter((u) => u.startsWith("/"));
  if (absolute.length) {
    throw new Error(
      `dist/ 是网页版构建（资源路径是绝对路径：${absolute.slice(0, 2).join(" , ")}），装进 .app 会白屏。\n` +
      `  用 \`npm run dist:mac\`（它会先跑 ELECTRON=1 vite build），别手动调 electron-builder。`,
    );
  }
  if (!refs.length) throw new Error("dist/index.html 里没有任何资源引用，构建产物不对");
  console.log(`  • 产物门禁通过  ${refs.length} 个资源引用，全为相对路径`);
}

exports.default = async function adhocSign(context) {
  if (context.electronPlatformName !== "darwin") return;
  assertDesktopBuild(path.join(__dirname, ".."));
  const appName = `${context.packager.appInfo.productFilename}.app`;
  const appPath = path.join(context.appOutDir, appName);
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", appPath], { stdio: "inherit" });
  const out = execFileSync("codesign", ["-dv", appPath], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  console.log(`  • ad-hoc 签名完成  ${appName}`);
  if (out && !/adhoc/.test(out)) throw new Error("ad-hoc 签名没生效，包出去也是打不开的");
};
