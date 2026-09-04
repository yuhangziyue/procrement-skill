import { defineConfig, loadEnv } from "vite";
import preact from "@preact/preset-vite";

// base 必须与仓库名一致：Pages 地址 https://yuhangziyue.github.io/procrement-skill/
// 桌面版从 file:// 加载 dist/index.html，必须用相对 base；网页版仍按仓库名。
const isElectron = !!process.env.ELECTRON;

/**
 * 只有桌面版才把 .env.local 里的 Key 烤进产物，让本机装的这份「打开即用」。
 *
 * ⚠️ 网页版**永远**拿不到它。理由很硬：本仓库是公开仓，网页版产物会推到 gh-pages 分支，
 * 一旦烤进去等于把 Key 挂到公网。所以这里用 isElectron 卡死，而不是靠"记得别构建网页版"。
 * 源码里也不写死 Key —— 它只存在于 gitignore 掉的 .env.local 和本机打出来的 .app 里。
 */
// 分发给别人的包必须用 XIAOCAI_NO_BUNDLED_KEY=1 构建：内置 Key 只适合自己这台机器，
// 跟着安装包发出去等于把额度交给对方，且撤不回来（只能作废重申请）。
const noBundledKey = process.env.XIAOCAI_NO_BUNDLED_KEY === "1";
const bundledKey = isElectron && !noBundledKey ? (loadEnv("production", process.cwd(), "VITE_").VITE_ARK_API_KEY ?? "") : "";

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
    // 桌面版内置 Key；网页版恒为空串
    __BUNDLED_ARK_KEY__: JSON.stringify(bundledKey),
    // pi-ai 部分依赖会探测 process.env，浏览器里给个空对象
    "process.env": {},
  },
});
