import { defineConfig } from "vite";
import preact from "@preact/preset-vite";

// base 必须与仓库名一致：Pages 地址 https://yuhangziyue.github.io/procrement-skill/
export default defineConfig({
  base: "/procrement-skill/",
  plugins: [preact()],
  // 仅本地开发：Coding Plan 端点的 CORS 预检不放行 Authorization，浏览器直连必挂（2026-09-03 实测）。
  // dev server 把 /ark/* 转发到方舟，设置页「代理地址」填 http://localhost:5173/ark/coding/v3 即可端到端联调。
  // 只作用于 vite dev，不进 build 产物；线上仍走 proxy/worker.js。
  server: {
    proxy: {
      "/ark": {
        target: "https://ark.cn-beijing.volces.com",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/ark/, "/api"),
        // 终端里看清每次实际打到方舟的路径与状态码，排查 404 / CORS 时不用猜
        configure: (proxy) => {
          proxy.on("proxyReq", (_req, req) => console.log(`[ark] → ${req.method} ${req.url}`));
          proxy.on("proxyRes", (res, req) => console.log(`[ark] ← ${res.statusCode} ${req.url}`));
        },
      },
    },
  },
  build: {
    target: "es2022",
    sourcemap: false,
  },
  define: {
    // pi-ai 部分依赖会探测 process.env，浏览器里给个空对象
    "process.env": {},
  },
});
