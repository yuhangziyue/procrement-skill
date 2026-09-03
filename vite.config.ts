import { defineConfig } from "vite";
import preact from "@preact/preset-vite";

// base 必须与仓库名一致：Pages 地址 https://yuhangziyue.github.io/procrement-skill/
// 桌面版从 file:// 加载 dist/index.html，必须用相对 base；网页版仍按仓库名。
const isElectron = !!process.env.ELECTRON;

export default defineConfig({
  base: isElectron ? "./" : "/procrement-skill/",
  plugins: [
    preact(),
    {
      // Chrome 的 Private Network Access：公网 https 页面（GitHub Pages）请求 http://localhost 时，
      // 预检必须带 Access-Control-Allow-Private-Network: true，否则即使 CORS 全开也是 Failed to fetch。
      // 只在 dev server 生效，不进产物。
      name: "xiaocai-private-network-access",
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.headers["access-control-request-private-network"]) res.setHeader("Access-Control-Allow-Private-Network", "true");
          next();
        });
      },
    },
  ],
  // 仅本地开发：Coding Plan 端点的 CORS 预检不放行 Authorization，浏览器直连必挂（2026-09-03 实测）。
  // dev server 把 /ark/* 转发到方舟，设置页「代理地址」填 http://localhost:5173/ark/coding/v3 即可端到端联调。
  // 只作用于 vite dev，不进 build 产物；线上仍走 proxy/worker.js。
  server: {
    // 允许任何来源跨域访问本地 dev server（含 /ark 代理）：这样线上 Pages 页面也能把「代理地址」填成
    // http://localhost:5173/ark/coding/v3，用本机 dev server 当个人代理（https 页面访问 http://localhost 浏览器放行）。
    // Vite 6+ 默认只放行 localhost 来源，github.io 来的预检会被拒 ⇒ 页面上看到的就是「跨域」。
    cors: true,
    proxy: {
      "/ark": {
        target: "https://ark.cn-beijing.volces.com",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/ark/, "/api"),
        // 终端里看清每次实际打到方舟的路径与状态码，排查 404 / CORS 时不用猜
        configure: (proxy) => {
          proxy.on("proxyReq", (_req, req) => console.log(`[ark] → ${req.method} ${req.url}`));
          proxy.on("proxyRes", (res, req) => {
            console.log(`[ark] ← ${res.statusCode} ${req.url}`);
            // 方舟自己也回 access-control-allow-origin: *，和 dev server 的 cors 叠成 "*,*"——浏览器判为非法值直接拒。
            // 上游的 CORS 头一律剥掉，只留 dev server 那一份。
            for (const h of Object.keys(res.headers)) if (h.startsWith("access-control-")) delete res.headers[h];
          });
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
