// 桌面版开发：先起 vite dev（顺带提供 /ark 代理），再把地址交给 Electron。
import { spawn } from "node:child_process";
import net from "node:net";

const PORT = Number(process.env.PORT ?? 5173);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const alive = () => new Promise((r) => {
  const s = net.connect(PORT, "127.0.0.1").on("connect", () => { s.end(); r(true); }).on("error", () => r(false));
});

const vite = spawn("npx", ["vite", "--port", String(PORT), "--strictPort"], { stdio: "inherit", shell: false });
for (let i = 0; i < 60 && !(await alive()); i++) await wait(500);
const electron = spawn("npx", ["electron", "."], {
  stdio: "inherit", shell: false,
  env: { ...process.env, VITE_DEV_SERVER_URL: `http://localhost:${PORT}/` },
});
const bye = () => { vite.kill(); electron.kill(); process.exit(0); };
electron.on("exit", bye);
process.on("SIGINT", bye);
