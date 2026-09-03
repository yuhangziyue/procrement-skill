# 小采 · 采购新人的 AI 师姐

> **一句话**：给采购新人的 AI 师姐——每天打开就知道今天该干什么，算账用程序不用嘴，会记住你教它的规矩。
> **两种形态**：**macOS 桌面版**（本地 SQLite，有工作看板 / 文档知识库 / U8 教程 / 学习计划）
> 与 **网页版**（GitHub Pages，对话 + 资料 + 增强卡）。
> **你的资料和对话只留在你自己的机器里**，不经过任何服务器。

这份 README 面向两类读者：

- **想直接用的采购新人** → 看「三张核心能力」和「三分钟用起来」就够了
- **想二次开发的前端** → 看「本地开发」「部署」，以及 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

---

## 桌面版：五个模块

| 模块 | 它替你做什么 |
|---|---|
| **🗂 工作台（看板）** | 导入生产表 / 加单表 / 订单执行报表，自动生成今天的待办，按 `35·时限 + 30·断料 + 12·日配 + 8·金额 + 8·供应商 + 7·滞留` 打分排序，分四条泳道：**要下单 / 等确认 / 在途催货 / 到货入库**。每张卡带「这一步做什么 → 什么算干完 → 卡住了找谁 + 开口第一句」。收工时给一段可直接发给领导的三句话。 |
| **📚 知识库** | 把公司制度、SOP、规格书（md/txt/csv/xlsx/docx/pdf）拖进来，自动切块并归到 10 类采购知识，问答时按需检索（SQLite FTS5 + 中文 bigram，全离线）。 |
| **🖥 U8 教程** | 用友 U8+ 的查询 / 导入 / 导出 / 单据流分步图文，每条菜单路径标了可信度：✅ 多来源确认 / ⚠️ 单来源待实机核对 / ❌ 路径未知。**没查实的绝不编**。 |
| **🎓 学习计划** | 16 周补齐盲区，四条赛道：基础知识 / 系统操作 / 跨部门对接 / 供应商对接。每条有「不懂会出什么事 → 怎么学 → 做哪件真实的活 → 学会了的凭据」。不做测验打分。 |
| **💬 采姐侧栏** | 常驻右侧，看板每张卡上的「问采姐」会自动把物料 / PO / 卡在哪一步带过去。 |

### 桌面版怎么跑

```bash
nvm use 22
npm i
npm run desktop      # 开发模式（顺带起 /ark 代理，本机联调模型不用另配）
npm run dist:mac     # 打包出 release/mac-arm64/小采.app 与 .dmg
```
数据库落在 `~/Library/Application Support/xiaocai/xiaocai.sqlite`，可以直接用 `sqlite3` 打开、可以整个复制走做备份。
未做代码签名——发给别人时对方需要右键打开。

---

## 三张核心能力（对话侧，两种形态都有）

| 能力 | 它替你做什么 | 试着这样问 |
|---|---|---|
| **下单算账** | 净缺口 = 需求 − 被替代 − 可用量 − 有效在途；多仓调拨优先；低于 MOQ 给三个方案让你定；凑整向上取整；交期倒推最晚下单日（工作日口径 / 发车日 / 接单截止 / 法定节假日）。**每一步算式原样输出，可直接贴进 PO 备注留痕。** | 「XX 料下周三要 3000，可用 800，在途 500，MOQ 2000，一箱 200，帮我算下单量和最晚下单日」 |
| **到货与跟单** | 导入跟单表或订单执行报表，生成给仓库的「明日到货预告」六列表；三色判定 🔴 逾期 / 🟡 临期 / 🟢 未到期，每一行附一条动作。 | 「明天到什么货？」「哪些单逾期了，我该先催谁？」 |
| **教它新规矩** | 一句「记住：……」或对回答点 👎 后选「教它正确做法」，抽成一张增强卡（意图 / 触发词 / 流程 / 注意事项），你确认后下次命中就照卡执行。新卡和旧卡冲突时并列展示，**由你拍板哪张生效**，不会自动覆盖。 | 「记住：日配件断料先查 B 仓，再问生产要不要调计划」 |

内置带教口吻：每个术语第一次出现带白话解释；给方案让你选，不替你定；一次只讲一件事并附工具；出错只讲「下次怎么做」。涉及 U8 菜单路径 / 单据名 / 税率的回答，在你没填公司配置前一律带「⚠️ 待实机核对」。

> **当前实现进度**（2026-09-03）：9 个工具全部接入 Agent——`search_knowledge`（本地 BM25 检索内置知识 / 增强卡 / 用户文档）、`lookup_material`、`calc_order_qty`、`backward_schedule`、`check_po`、`arrival_notice`、`track_status`、`save_summary`、`save_enhancement`；资料导入（CSV/xlsx，GB18030 回退）、导出/导入备份、增强卡面板（冲突由用户拍板）、👍👎 反馈与「已采用」、38 张内置知识卡首启自动种入。73 个单元测试。真实模型端到端已验收（Node 侧 `ARK_LIVE=1 npx vitest run src/agent/live.test.ts`；浏览器侧经 vite dev `/ark` 代理）：模型按人设先查物料、再调 `calc_order_qty`、复述算式与 MOQ 三选一。未做：移动端布局。详见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

---

## 三分钟用起来

1. **打开 Pages 地址**：`https://<你的 GitHub 用户名>.github.io/<仓库名>/`（本仓库线上地址：https://yuhangziyue.github.io/procrement-skill/ ；fork 后由 GitHub Actions 自动推 `gh-pages` 分支发布，见下文「部署」）。
2. **点右上角「⚙ 设置」**，填三项：
   - **API Key**：火山方舟控制台申请的 Key（只存在你浏览器的 localStorage，导出时自动剔除）
   - **Base URL**：见下方「接入说明」
   - **模型**：默认 `doubao-seed-2.0-pro`，可换成你账号下任意支持工具调用的模型
   - （可选）**公司配置五问**：用友产品版本 / 是否走请购 / 有无到货单环节 / 权限边界 / 跟踪报表名。填齐后回答不再带 ⚠️。
3. **（可选）导入三张模板资料**：到 [`templates/`](templates/README.md) 下载物料清单 / 供应商档案 / 跟单表三张 CSV 模板，按字段头填上你自己的数据，在「资料库」导入。不导也能聊，导了才会查表、出到货预告和三色表。

### 接入说明（请如实对照你手里的 Key）

火山方舟有两种端点，浏览器直连的表现不一样：

| 端点 | Base URL | 浏览器能否直连 | 怎么用 |
|---|---|---|---|
| **标准按量端点** | `https://ark.cn-beijing.volces.com/api/v3` | ✅ 可以 | 设置里填这个 Base URL + Key，直接用 |
| **Coding Plan 端点** | `https://ark.cn-beijing.volces.com/api/coding/v3` | ❌ 不行 | CORS 预检不放行 `Authorization` 头（2026-09-03 实测，`access-control-allow-headers` 只有 `Origin,Content-Length,Content-Type`），浏览器发出的请求会被拦。**要用 Coding Plan Key，需自行部署 [`proxy/worker.js`](proxy/worker.js)**，再在设置的「代理地址」里填 Worker 的 URL |

**没有 Cloudflare 时的过渡方案：把本机 dev server 当个人代理**（只对你自己这台电脑有效）

```bash
npm run dev          # 本机起 http://localhost:5173，自带 /ark → 方舟 的代理
```
然后在线上页面「设置」里选「方舟 Coding Plan（经代理）」，代理地址填 `http://localhost:5173/ark/coding/v3`。
dev server 已配好三件事：`cors: true`（放行 github.io 来源）、预检带 `Access-Control-Allow-Private-Network`（Chrome 公网页面访问 localhost 必需）、剥掉上游重复的 CORS 头（否则叠成 `*,*` 被浏览器判非法）。关掉 dev server 线上页面就连不上，这不是 bug。

**部署代理（Cloudflare Worker，免费额度 10 万次/天）**：

```bash
cd proxy
npm i -g wrangler && wrangler login
# 把 worker.js 里 ALLOW_ORIGINS 改成你自己的 Pages 域名
wrangler deploy
```

Worker 只做两件事：把请求透传到上游、补齐 CORS 头，路径白名单只放行 `/chat/completions` 与 `/models`。默认是**透传模式**——你的 Key 仍然只在浏览器里、由请求头带过去，Worker 不存任何 Key。若你是站长自用、不想把 Key 填进浏览器，可用 `wrangler secret put ARK_API_KEY` / `PROXY_TOKEN` 切到托管模式。

### ⚠️ 「代理地址」不能填 VPN / Clash 的本地端口

常见误填：把 `http://127.0.0.1:7890` 这类**系统代理端口**填进「代理地址」，结果报 400。原因是两种代理压根不是一回事：

| | 正向代理（VPN / Clash / 系统代理） | 反向代理（本项目要的） |
|---|---|---|
| 客户端怎么用 | 配置成「我的出口」，它只搬字节 | 当成服务端直接请求它 |
| 能否改响应头 | ❌ Clash / Mihomo 不支持响应改写 | ✅ 这就是它的全部工作 |
| 能否解跨域 | ❌ | ✅ |

浏览器判不判跨域，只看**响应头**里有没有 `Access-Control-Allow-Origin` / `Allow-Headers`；只搬字节的东西加不了这些头。而 7890 讲的是 HTTP-proxy 协议，对一个普通 `POST /chat/completions` 只会回 400。设置页已经会识别这类地址并给出提示，旁边的「测试连接」按钮可以先打一发 1 token 的探测请求。

同理，**Cloudflare Worker 不是 Service Worker**：前者跑在边缘服务器上，是服务端到服务端，不受同源策略约束；后者跑在浏览器里，跨域拿到的仍是 opaque response。要解跨域，只能把请求挪出浏览器。

---

## 隐私与边界

- **Key 只在 localStorage**，全量导出时强制剔除；隐私模式写不进去时页面仍可用（每次手填）。
- **所有数据只在 IndexedDB**（会话 / 消息 / 小结 / 资料 / 增强卡 / 反馈 / 设置七张表），不上传、不同步、不采集。
- **清浏览器缓存 = 清空一切**。请定期用「导出」备份：全量 JSON / 单会话 Markdown / 增强卡 JSON（可分享给同事）/ 到货预告与跟单表 CSV。
- 仓库层面：`.gitignore` 拦下 `*.csv *.xlsx` 及一切私有资料文件名模式，只放行 `templates/` 下的脱敏模板；CI 里的**隐私守卫**（`scripts/privacy-guard.mjs`）命中供应商实名 / 真人姓名 / 客户品牌 / 私有文件名即构建失败——宁可发布不了，也不泄露。
- **明确不做（v1）**：多用户、云同步、服务端存储、直连 U8、语音、移动端原生。

---

## 本地开发

要求 **Node ≥ 22.19**（`@earendil-works/pi-ai` 的硬要求）。

```bash
npm i
npm run dev        # http://localhost:5173/<仓库名>/
npm run build      # tsc --noEmit && vite build → dist/
npm run preview    # 本地预览 dist
npm run typecheck  # 只做类型检查
npm run guard      # 隐私守卫（CI 同款）
npx vitest run     # 单元测试（src/tools/*.test.ts）
```

目录一览与模块职责见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

---

## 部署

push 到 `master` → GitHub Actions（[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)）依次执行 `npm ci` → `npm run guard` → `npm test` → `npm run deploy:pages`：
后者构建后做产物门禁（`index.html` 存在、主 js 体积正常），再把 `dist/` 作为 orphan 提交**强推到 `gh-pages` 分支**；真正的发布由 GitHub 内置的 `pages build and deployment` 完成。判据：Actions 列表里出现该内置任务且成功 ⇒ 线上已更新。

**为什么走 `gh-pages` 分支而不是 Pages 的「GitHub Actions」Source**（2026-09-03 实证）：Pages 站点只能由仓库 owner 在 Settings 里创建，`GITHUB_TOKEN` 无权代劳（`configure-pages enablement:true` 实测失败，`deploy-pages` 在站点不存在时直接红）。而首次推 `gh-pages` 分支时 GitHub 会自动建站并把 Source 设为该分支，**fork 后零手动设置即可上线**。本地也可以手动发：`npm run deploy:pages`（与 CI 同一脚本，不会漂）。

fork 后要改的两个常量：
- [`vite.config.ts`](vite.config.ts) 的 `base`（= `/<你的仓库名>/`）
- `proxy/worker.js` 里的 `ALLOW_ORIGINS`（若你部署了代理）

## 技术栈

桌面壳 Electron 38（内置 Node 22 的 `node:sqlite`，**零原生编译、不需要 Rust**）+ electron-builder；
存储层做了 Dexie 兼容抽象，桌面走 SQLite、网页走 IndexedDB，业务代码不感知。详见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) §10。


Vite 8 · Preact 10 · TypeScript · `@earendil-works/pi-agent-core` + `@earendil-works/pi-ai`（仅 openai-completions 路径，≈160 KB gzip）· TypeBox · Dexie 4（IndexedDB）· date-fns · papaparse · SheetJS（懒加载）· marked + DOMPurify · Cloudflare Worker（可选代理）· GitHub Actions → gh-pages 分支 → Pages

## 许可证

待定（倾向 MIT）。正式发布前会补上 `LICENSE` 文件；在此之前请视为「保留所有权利」。
