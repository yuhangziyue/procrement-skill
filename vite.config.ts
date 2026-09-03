import { defineConfig } from "vite";
import preact from "@preact/preset-vite";

// base 必须与仓库名一致：Pages 地址 https://yuhangziyue.github.io/procrement-skill/
export default defineConfig({
  base: "/procrement-skill/",
  plugins: [preact()],
  build: {
    target: "es2022",
    sourcemap: false,
  },
  define: {
    // pi-ai 部分依赖会探测 process.env，浏览器里给个空对象
    "process.env": {},
  },
});
