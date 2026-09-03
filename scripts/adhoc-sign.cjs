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

exports.default = async function adhocSign(context) {
  if (context.electronPlatformName !== "darwin") return;
  const appName = `${context.packager.appInfo.productFilename}.app`;
  const appPath = path.join(context.appOutDir, appName);
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", appPath], { stdio: "inherit" });
  const out = execFileSync("codesign", ["-dv", appPath], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  console.log(`  • ad-hoc 签名完成  ${appName}`);
  if (out && !/adhoc/.test(out)) throw new Error("ad-hoc 签名没生效，包出去也是打不开的");
};
