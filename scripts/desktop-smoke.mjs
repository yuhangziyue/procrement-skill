// 桌面版真机冒烟：起 Electron（用打包前的 dist），在渲染进程里跑一串断言，退出码即结论。
// 为什么不用无头浏览器：要验的是 preload 通道 + node:sqlite 落盘，那两样只在 Electron 里存在。
import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

const root = path.resolve(import.meta.dirname, "..");
const probe = path.join(os.tmpdir(), `xiaocai-smoke-${Date.now()}.cjs`);

fs.writeFileSync(probe, `
const { app, BrowserWindow } = require("electron");
const path = require("node:path");
let code = 1;
app.whenReady().then(async () => {
  // 复用真正的主进程逻辑
  require(${JSON.stringify(path.join(root, "electron", "main.cjs"))});
  await new Promise((r) => setTimeout(r, 2500));
  const win = BrowserWindow.getAllWindows()[0];
  if (!win) { console.log("FAIL 没有窗口"); app.exit(1); return; }
  const out = await win.webContents.executeJavaScript(\`(async () => {
    const r = { ok: [], bad: [] };
    const t = (name, cond) => (cond ? r.ok : r.bad).push(name);
    t("preload 通道存在", !!window.xiaocai?.isDesktop);
    const nav = document.querySelectorAll(".rail-item").length;
    t("一级导航渲染(5 项)", nav === 5);
    t("看板主区渲染", !!document.querySelector(".board, .board-view, [class*='board']"));
    t("采姐侧栏常驻", !!document.querySelector(".shell-chat"));
    try {
      await window.xiaocai.call("table.put", "settings", [{ key: "__smoke", value: { n: 1 } }]);
      const got = await window.xiaocai.call("table.get", "settings", "__smoke");
      t("SQLite 读写往返", got && got.value && got.value.n === 1);
      await window.xiaocai.call("table.delete", "settings", ["__smoke"]);
    } catch (e) { r.bad.push("SQLite 读写: " + e.message); }
    try {
      await window.xiaocai.call("kb.upsertDoc", { id: "__smoke", title: "冒烟文档", category: "policy", tags: [], charCount: 20, createdAt: Date.now(), updatedAt: Date.now() });
      await window.xiaocai.call("kb.insertChunks", "__smoke", [{ id: "__smoke_c1", seq: 0, heading: "请购流程", category: "policy", text: "请购单由生产部提出，采购部审核后转采购订单。" }]);
      const hits = await window.xiaocai.call("kb.search", "请购单谁提", { limit: 3 });
      t("中文全文检索命中", Array.isArray(hits) && hits.length > 0);
      await window.xiaocai.call("kb.deleteDoc", "__smoke");
    } catch (e) { r.bad.push("知识库: " + e.message); }
    try {
      const day = await window.xiaocai.call("board.getDay", "2026-09-03");
      t("看板当日记录可读", !!day && typeof day === "object");
    } catch (e) { r.bad.push("看板: " + e.message); }
    const cs = getComputedStyle(document.querySelector(".shell") || document.body);
    t("外壳不撑破视口", document.documentElement.scrollHeight <= window.innerHeight + 2);
    return r;
  })()\`);
  console.log("PASS: " + out.ok.join(" / "));
  if (out.bad.length) console.log("FAIL: " + out.bad.join(" / "));
  code = out.bad.length ? 1 : 0;
  app.exit(code);
});
`);

const child = spawn(path.join(root, "node_modules", ".bin", "electron"), [probe], {
  cwd: root,
  stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined, ELECTRON_ENABLE_LOGGING: undefined },
});
let buf = "";
child.stdout.on("data", (d) => { buf += d; process.stdout.write(d); });
child.stderr.on("data", (d) => { const s = String(d); if (/FAIL|Error/.test(s)) process.stderr.write(d); });
child.on("exit", (c) => {
  fs.rmSync(probe, { force: true });
  if (!/PASS:/.test(buf)) { console.error("冒烟没跑起来"); process.exit(1); }
  process.exit(c ?? 1);
});
