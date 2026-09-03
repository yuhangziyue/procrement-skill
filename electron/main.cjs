// Electron 主进程。
// 为什么是 .cjs：项目 package.json 是 "type":"module"，而 Electron 38 的 ESM 主进程入口
// 拿不到 electron 的具名导出（`import { app } from "electron"` 报 no export；default 又是 undefined，实测两次）。
// 主进程用 CJS 最稳，业务模块仍是 ESM，靠动态 import 引进来。
const { app, BrowserWindow, ipcMain, shell, dialog } = require("electron");
const path = require("node:path");
const fs = require("node:fs");

const DEV_URL = process.env.VITE_DEV_SERVER_URL;
let API = {};

function createWindow() {
  const win = new BrowserWindow({
    width: 1380, height: 900, minWidth: 1040, minHeight: 640,
    title: "小采 · 采购工作台",
    titleBarStyle: "hiddenInset",
    backgroundColor: "#f6f7f9",
    webPreferences: { preload: path.join(__dirname, "preload.cjs"), sandbox: false, contextIsolation: true },
  });
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: "deny" }; });
  if (DEV_URL) { win.loadURL(DEV_URL); win.webContents.openDevTools({ mode: "detach" }); }
  else win.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  return win;
}

/**
 * 桌面版不需要任何反向代理：主进程能改响应头，浏览器那道 CORS 墙在这里可以直接拆。
 *
 * 背景：方舟 Coding Plan 端点（/api/coding/v3）的 CORS 预检不放行 Authorization 头，
 * 所以网页版必须挂一个 Cloudflare Worker 中转。Electron 里没这个必要——
 * 请求发出前把 Origin 摘掉（file:// 的 Origin 是 "null"，上游会拒），
 * 响应回来时把 Access-Control-* 换成放行的值，预检和正式请求都能过。
 *
 * 只作用于 http(s) 请求；应用自身的页面走 file://，不受影响。
 */
function relaxCorsForApi(session) {
  const filter = { urls: ["http://*/*", "https://*/*"] };
  session.webRequest.onBeforeSendHeaders(filter, (details, cb) => {
    const headers = { ...details.requestHeaders };
    // file:// 页面发出的 Origin 是字符串 "null"，方舟会直接 403；摘掉当作服务端到服务端的调用
    delete headers.Origin;
    delete headers.origin;
    cb({ requestHeaders: headers });
  });
  session.webRequest.onHeadersReceived(filter, (details, cb) => {
    const headers = { ...details.responseHeaders };
    // 上游自己带的 CORS 头要先删干净，否则和我们加的叠成 "*,*"，浏览器判非法值照样拒
    for (const k of Object.keys(headers)) if (k.toLowerCase().startsWith("access-control-")) delete headers[k];
    headers["Access-Control-Allow-Origin"] = ["*"];
    headers["Access-Control-Allow-Headers"] = ["*"];
    headers["Access-Control-Allow-Methods"] = ["GET,POST,PUT,DELETE,OPTIONS"];
    cb({ responseHeaders: headers });
  });
}

app.whenReady().then(async () => {
  relaxCorsForApi(require("electron").session.defaultSession);

  const T = await import("./db.mjs");
  const F = await import("./features.mjs");

  const dir = app.getPath("userData");
  fs.mkdirSync(dir, { recursive: true });
  const dbFile = path.join(dir, "xiaocai.sqlite");
  T.openDb(dbFile);
  console.log("[xiaocai] sqlite:", dbFile);

  /** 白名单：渲染进程只能点名调用这些函数，不能下发任意 SQL */
  API = {
    "table.all": T.tableAll, "table.get": T.tableGet, "table.byIndex": T.tableByIndex,
    "table.put": (t, rows) => T.tablePut(t, rows, "put"), "table.add": (t, rows) => T.tablePut(t, rows, "add"),
    "table.update": T.tableUpdate, "table.delete": T.tableDelete, "table.deleteByIndex": T.tableDeleteByIndex,
    "kb.listDocs": F.listDocs, "kb.upsertDoc": F.upsertDoc, "kb.deleteDoc": F.deleteDoc,
    "kb.insertChunks": F.insertChunks, "kb.search": F.searchChunks,
    "board.list": F.listTasks, "board.upsert": F.upsertTasks, "board.update": F.updateTask,
    "board.delete": F.deleteTasks, "board.getDay": F.getDay, "board.setDay": F.setDay,
    "learn.list": F.listProgress, "learn.set": F.setProgress,
  };

  ipcMain.handle("xiaocai:call", (_e, name, args) => {
    const fn = API[name];
    if (!fn) throw new Error(`未开放的接口: ${name}`);
    return fn(...(args ?? []));
  });
  ipcMain.handle("xiaocai:dbPath", () => dbFile);
  ipcMain.handle("xiaocai:reveal", () => shell.showItemInFolder(dbFile));
  ipcMain.handle("xiaocai:saveFile", async (_e, { name, data }) => {
    const r = await dialog.showSaveDialog({ defaultPath: name });
    if (r.canceled || !r.filePath) return null;
    fs.writeFileSync(r.filePath, Buffer.from(data));
    return r.filePath;
  });

  createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
