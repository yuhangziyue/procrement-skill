// Electron 主进程。
// 为什么是 .cjs：项目 package.json 是 "type":"module"，而 Electron 38 的 ESM 主进程入口
// 拿不到 electron 的具名导出（`import { app } from "electron"` 报 no export；default 又是 undefined，实测两次）。
// 主进程用 CJS 最稳，业务模块仍是 ESM，靠动态 import 引进来。
const { app, BrowserWindow, ipcMain, shell, dialog } = require("electron");
const path = require("node:path");
const fs = require("node:fs");

const DEV_URL = process.env.VITE_DEV_SERVER_URL;
let API = {};

// ⚠️ 数据目录必须钉死，不能跟着 app 名字走。
// Electron 默认把 userData 放在 appData/<app.getName()>，而 getName() 会因为
// 打包/未打包、productName 改名而变（实测：未打包时是 "Electron"，打包后是 "xiaocai"）。
// 一旦哪天改了产品名，用户的会话、资料、知识库、看板就会"凭空消失"——其实是换了个目录。
// 钉成常量后，无论怎么改名、怎么覆盖安装，数据都在原地。这个值一旦发布就永不修改。
const DATA_DIR_NAME = "xiaocai";
app.setPath("userData", path.join(app.getPath("appData"), DATA_DIR_NAME));

function createWindow() {
  const win = new BrowserWindow({
    width: 1380, height: 900, minWidth: 1040, minHeight: 640,
    title: "小采 · 采购工作台",
    titleBarStyle: "hiddenInset",
    // 红绿灯按钮默认压在页面左上角（品牌区），把它往下挪出安全区；NavRail 顶部同步留白
    trafficLightPosition: { x: 14, y: 20 },
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

  // 覆盖安装保险：应用版本变化时，先把旧库整体复制一份再打开。
  // 建表用的是 CREATE TABLE IF NOT EXISTS（只增不删），正常升级不会丢数据；
  // 但"正常"是假设，备份是兜底——出事时用户至少能拿回昨天的库。
  try {
    const stampFile = path.join(dir, "app-version.json");
    const prev = fs.existsSync(stampFile) ? JSON.parse(fs.readFileSync(stampFile, "utf8")) : null;
    if (fs.existsSync(dbFile) && prev?.version !== app.getVersion()) {
      const bak = path.join(dir, `xiaocai.backup-${prev?.version ?? "unknown"}-${new Date().toISOString().slice(0, 10)}.sqlite`);
      if (!fs.existsSync(bak)) fs.copyFileSync(dbFile, bak);
      console.log("[xiaocai] 版本变化，已备份旧库:", bak);
      // 只留最近 3 份备份，别把用户磁盘吃光
      const baks = fs.readdirSync(dir).filter((f) => f.startsWith("xiaocai.backup-")).sort();
      for (const f of baks.slice(0, Math.max(0, baks.length - 3))) fs.rmSync(path.join(dir, f), { force: true });
    }
    fs.writeFileSync(stampFile, JSON.stringify({ version: app.getVersion(), at: Date.now() }, null, 2));
  } catch (e) {
    console.warn("[xiaocai] 备份旧库失败（不阻塞启动）:", e.message);
  }

  T.openDb(dbFile);
  console.log("[xiaocai] sqlite:", dbFile, "| userData:", dir);

  /** 白名单：渲染进程只能点名调用这些函数，不能下发任意 SQL */
  API = {
    "table.all": T.tableAll, "table.get": T.tableGet, "table.byIndex": T.tableByIndex,
    "table.put": (t, rows) => T.tablePut(t, rows, "put"), "table.add": (t, rows) => T.tablePut(t, rows, "add"),
    "table.update": T.tableUpdate, "table.delete": T.tableDelete, "table.deleteByIndex": T.tableDeleteByIndex,
    "kb.listDocs": F.listDocs, "kb.upsertDoc": F.upsertDoc, "kb.deleteDoc": F.deleteDoc,
    "kb.insertChunks": F.insertChunks, "kb.search": F.searchChunks, "kb.listChunks": F.listChunks,
    "board.list": F.listTasks, "board.upsert": F.upsertTasks, "board.update": F.updateTask,
    "board.delete": F.deleteTasks, "board.getDay": F.getDay, "board.setDay": F.setDay,
    "learn.list": F.listProgress, "learn.set": F.setProgress,
    // 盲区表复用宽表通道（id + 索引列 + data JSON），逻辑与合并规则都在渲染侧 TS 里，有单测
    "blindspot.list": () => T.tableAll("blindspots"),
    "blindspot.set": (row) => T.tablePut("blindspots", Array.isArray(row) ? row : [row], "put"),
    "blindspot.remove": (id) => T.tableDelete("blindspots", Array.isArray(id) ? id : [id]),
  };

  ipcMain.handle("xiaocai:call", (_e, name, args) => {
    const fn = API[name];
    if (!fn) throw new Error(`未开放的接口: ${name}`);
    return fn(...(args ?? []));
  });
  ipcMain.handle("xiaocai:dbPath", () => dbFile);
  ipcMain.handle("xiaocai:dataDir", () => dir);
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
