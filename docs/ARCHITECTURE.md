# 小采 · 架构说明

> 面向二次开发者。产品层面的「怎么用」见仓库根目录 [README.md](../README.md)。
> 关键词：纯前端、零后端、Agent 循环跑在浏览器里、所有用户数据只落 IndexedDB。

---

## 1. 总览

```
 ┌─────────────────────────── 浏览器（GitHub Pages 静态页）────────────────────────────┐
 │                                                                                    │
 │  UI 层  src/ui/*  +  src/app.tsx        Preact + Vite + TS                          │
 │  ├─ 聊天区：流式渲染 · 工具结果卡片 · Markdown（marked + DOMPurify）                     │
 │  ├─ 侧栏：会话列表 · 资料库 · 增强卡 · 模板下载                                          │
 │  └─ 设置：Base URL / 代理地址 / API Key / 模型 / 公司配置五问                            │
 │                              │ agent.prompt() / agent.subscribe()                   │
 │  Agent 层  src/agent/*        @earendil-works/pi-agent-core                         │
 │  ├─ systemPrompt = 人设 + 执行原则 + 公司配置（未填→⚠️）+ 全部启用的增强卡                 │
 │  ├─ tools（TypeBox schema，全部确定性计算）                                              │
 │  │    calc_order_qty · backward_schedule · save_summary   ← 已注册到 Agent            │
 │  │    lookup_material · check_po · arrival_notice · track_status ← 纯函数就位，接入中   │
 │  │    search_knowledge · save_enhancement                 ← 里程碑中                  │
 │  └─ state.messages ⇄ IndexedDB messages 表（原样落库、原样回灌）                         │
 │                              │ streamFn                                              │
 │  LLM 层  src/llm/model.ts     @earendil-works/pi-ai/api/openai-completions            │
 │  └─ Model<'openai-completions'>{ baseUrl = proxyUrl || baseUrl, id } + 显式 apiKey     │
 │                              │                                                       │
 │  存储层  src/db/*             Dexie 4 / IndexedDB（7 张表）+ localStorage（仅 apiKey）    │
 └──────────────────────────────┼───────────────────────────────────────────────────────┘
                                │ HTTPS（SSE 流式）
              ┌─────────────────┴──────────────────┐
              │                                     │
   直连：标准端点 /api/v3            经代理：Cloudflare Worker（proxy/worker.js）
   （CORS 放行 Authorization）       补 CORS 头 → 上游 Coding Plan 端点 /api/coding/v3
              │                                     │
              └────────────► 火山方舟 OpenAI 兼容 chat/completions ◄────────────┘
```

**没有后端。** 唯一可选的服务端组件是 Cloudflare Worker，它只做 CORS 透传，不存数据、不存 Key（透传模式）。

---

## 2. 模块表

| 目录 / 文件 | 职责 |
|---|---|
| `src/main.tsx` | 挂载入口，渲染 `<App/>` |
| `src/app.tsx` | 应用壳：会话切换、Agent 实例生命周期、事件订阅驱动 UI、消息持久化 |
| `src/agent/create-agent.ts` | 组装 `Agent` 实例：读设置 + 公司配置 + 增强卡 → systemPrompt；注入 model / streamFn / tools / 历史消息 |
| `src/agent/system-prompt.ts` | 人设与硬规矩常量；`buildSystemPrompt(company, cards)` 拼接公司配置与增强卡 |
| `src/llm/model.ts` | 火山方舟适配：构造 `Model<'openai-completions'>`（含 compat 开关）、`arkStreamFn` 每次调用时从 localStorage 取 Key |
| `src/tools/` | 确定性计算工具。`index.ts` 把纯函数包成 `AgentTool`（TypeBox schema）并由 `buildTools(ctx)` 统一注册；纯函数：`calc-order-qty.ts`（净缺口 / 调拨 / MOQ / 凑整）、`backward-schedule.ts`（交期倒推）、`calendar.ts`（法定节假日 / 调休 / 工作日）、`lookup-material.ts`（编码优先匹配 + 采购状态判定）、`check-po.ts`（PO 十要素）、`arrival-notice.ts`（明日到货六列表）、`track-status.ts`（三色判定，日期宽松解析）；`format.ts` 把结果渲染成 Markdown；`save-summary.ts` 是唯一碰 db 的工具（写 `summaries` 表）；`*.test.ts` 为 vitest 用例 |
| `src/db/schema.ts` | Dexie 数据库类与七张表的行类型 |
| `src/db/settings.ts` | 设置读写：apiKey 走 localStorage，其余走 `settings` 表；`LlmSettings` / `CompanyConfig` 类型与默认值 |
| `src/ui/` | Preact 组件：`Sidebar`（会话列表）、`MessageList`（消息与流式气泡）、`Composer`（输入框 / 中止）、`SettingsPanel`（端点 / Key / 模型 / 五问） |
| `src/util/` | `id.ts`（ID 生成）、`markdown.ts`（marked + DOMPurify 安全渲染） |
| `src/styles.css` | 全局样式 |
| `knowledge/` | 内置知识 Markdown（岗位技能树、U8 基础、下单 / 入库 / 跟单三份 SOP、下单清单），首启切成 builtin 增强卡 |
| `templates/` | 三张脱敏 CSV 模板（物料清单 / 供应商档案 / 跟单表）及字段说明 |
| `proxy/` | Cloudflare Worker 代理源码与 `wrangler.toml` |
| `scripts/privacy-guard.mjs` | 隐私守卫：扫描 `src/ knowledge/ templates/ proxy/ index.html README.md`，命中禁入词即退出码 1 |
| `.github/workflows/deploy.yml` | push master → guard → test → `scripts/deploy-pages.mjs`（构建 + 产物门禁 + 强推 `gh-pages` 分支），由 GitHub 内置 pages build and deployment 发布 |

---

## 3. 数据模型（Dexie schema v1，数据库名 `xiaocai`）

| 表 | 主键 / 索引 | 内容 | 备注 |
|---|---|---|---|
| `sessions` | `id`, `updatedAt` | 会话标题、时间戳、可选 `summaryId`、`tags[]` | 标题取首条用户消息前 24 字 |
| `messages` | `id`, `sessionId`, `createdAt` | `content` 字段存 pi 的 `AgentMessage` **原样** | 恢复会话时无损回灌 `agent.state.messages`，不做任何转换 |
| `summaries` | `id`, `sessionId` | `kind: 'po_done' \| 'manual' \| 'close'`，正文、`keyFacts[]`、`openItems[]` | 按**事件**触发（一张 PO 走完 / 用户点小结 / 关会话），不按轮数 |
| `materials` | `id`, `role`, `name` | 用户导入的资料：`kind`（csv/xlsx/md/txt）、`role`（materials/tracking/suppliers/doc）、`rawBlob`、解析后的 `rows` 或 `text`、`version` | 二次导入同名资料版本 +1 并给差异数 |
| `enhancements` | `id`, `origin`, `enabled` | 增强卡：`intents[]`、`triggers[]`、`sop[]`、`cautions[]`、`examples[]`、`origin`（builtin/user/taught）、`conflictsWith[]`、`sourceSessionId?` | builtin 可关不可删 |
| `feedback` | `id`, `sessionId`, `messageId` | `vote: 1 \| -1`、`note?`、`adopted?` | `adopted` = 工具结果卡上的「已采用」，是采纳率指标的数据源 |
| `settings` | `key` | `llm`（baseUrl / modelId / proxyUrl）、`company`（五问）、节假日补充、导出提醒时间等 | **apiKey 不在这张表**，见下 |

**apiKey 的位置**：`localStorage["xiaocai.apiKey"]`。刻意与 IndexedDB 分离，这样「导出全量 JSON」天然不带 Key，不需要在导出逻辑里再做剔除。

**导出形态**：全量 JSON（materials 默认不带、需勾选）/ 单会话 Markdown（含小结）/ 增强卡 JSON（可分享）/ 到货预告与跟单表 CSV。

---

## 4. Agent 层：怎么用 pi-agent-core

### 4.1 一个会话一个 `Agent` 实例

```ts
new Agent({
  initialState: {
    systemPrompt: buildSystemPrompt(company, cards),   // 每次重建时重新拼
    model: buildArkModel(llm),                        // Model<'openai-completions'>
    thinkingLevel: "off",
    tools,                                            // AgentTool<TypeBox schema>[]
    messages: historyFromIndexedDB,                   // 原样回灌
  },
  streamFn: arkStreamFn,
  sessionId,
  toolExecution: "sequential",
});
```

设置或增强卡一变就**重建**实例，把 `state.messages` 原样带过去——不做增量 patch，简单可靠。

### 4.2 `streamFn`：Key 在调用时刻读取

`arkStreamFn` 包一层 `streamSimple`，每次调用都从 localStorage 取 Key 再传 `apiKey`。好处：改了设置立即生效，Key 不进 `Model` 对象、不进 Agent state、不会被序列化到任何地方。

### 4.3 工具用 TypeBox 声明 schema

工具参数 schema 用 `typebox` 声明（pi-agent-core 的原生格式），`execute` 里只做确定性计算并返回结构化结果 + 一段可读文本。业务逻辑本体放在 `src/tools/*.ts` 的纯函数里（如 `calcOrderQty(input): CalcResult`），工具包装层只负责 schema 与格式化，纯函数单独跑 vitest。

### 4.4 事件驱动 UI

`agent.subscribe(ev => …)`，UI 只听四类事件：

| 事件 | UI 动作 |
|---|---|
| `message_start` / `message_update` | 若是 assistant 消息，更新「正在流式输出」的气泡 |
| `message_end` / `turn_end` | 清流式气泡，用 `agent.state.messages` 整体刷新列表 |
| `agent_end` | 解除 busy；若 `state.errorMessage` 有值则显示错误横幅；**此刻持久化** |

### 4.5 持久化：`state.messages` 原样落库

`agent_end` 时把 `agent.state.messages` 整个写回 `messages` 表（先删后 bulkAdd，一个事务），`id` 为 `${sessionId}:${index}`。恢复时按 `createdAt` 排序取出 `content` 数组直接喂给 `initialState.messages`。不自己定义消息格式，避免与 pi 的类型漂移。

---

## 5. 为什么只引 `@earendil-works/pi-ai/api/openai-completions`

`@earendil-works/pi-ai` 包根导出会把多家厂商 SDK 一起拉进依赖图；对一个只连 OpenAI 兼容端点的浏览器应用来说，这些全是死重。

做法：

- `import { streamSimple } from "@earendil-works/pi-ai/api/openai-completions"` —— 只走这一条子路径
- `Model` 只作 `import type`，零运行时开销
- `vite.config.ts` 里 `define: { "process.env": {} }`，堵住依赖里对 `process.env` 的探测
- 火山方舟不在 pi 的 URL 自动识别表里，`compat` 显式声明：不发 `store` / `developer` role / `reasoning_effort`，`max_tokens` 字段名、流式 usage 等按方舟口径

**结果**：本机 `vite build` 后唯一的 JS 产物 gzip 约 **160 KB**（实测在 156–162 KB 区间浮动，取决于 vite 与 gzip 版本），低于 300 KB 的预算线。这个体积里包含 Preact、Dexie、date-fns、marked、DOMPurify、papaparse 与 pi-agent-core / pi-ai 的 openai-completions 路径；SheetJS 走懒加载不计入首屏。若后续 pi 升级把体积拉爆，退路是直接换 openai SDK 自写工具循环——`create-agent.ts` 是薄适配层，切换成本可控。

---

## 6. 增强卡机制

```
 「记住：……」  或  👎 → 「教它正确做法」  或  上传流程文档
        ▼
 save_enhancement(draft) → UI 预览卡（意图 · 触发词 · 流程 · 注意事项 · 示例）→ 用户改 / 确认
        ▼
 enhancements 表 +1（origin='taught'）
        ▼
 下一轮起，所有 enabled 卡全量注入 systemPrompt
```

- **三种来源**：`builtin`（`knowledge/*.md` 首启切卡，可关不可删）/ `user`（用户手写或导入 JSON）/ `taught`（对话中教出来的）。
- **全量注入，不做检索路由**：卡片数 < 15 时全部拼进 systemPrompt（约 1.5k token），比「先分类再取卡」少一次往返、少一个出错点。
- **冲突由用户拍板**：新卡触发词与旧卡重叠 → 两张并列标黄，用户点选哪张生效；被停的保留可回退。**后教的不自动覆盖先教的。**
- 与公司配置的边界：U8 产品版本 / 是否走请购 / 有无到货单 / 权限边界 / 跟踪报表名这五项是**配置**不是知识，进设置页而非增强卡；任一未填，涉及菜单路径的回答自动带「⚠️ 待实机核对」。

---

## 7. 工具设计原则

1. **算账不让模型口算。** 净缺口、调拨、MOQ、凑整、倒推、三色判定全部是纯函数；模型只负责把用户话里的数字抠出来填参数，以及把结果说成人话。
2. **算式原样输出留痕。** 每个工具返回 `steps[]` / `timeline[]` / `formula`，逐步写明「净缺口 = 需求 3000 − 被替代 0 − 可用量 800 − 有效在途 500 = 1700」这种可直接贴进 PO 备注的字符串。
3. **决策留给人。** 缺口低于 MOQ 时给三个方案（凑到 MOQ / 问拼单 / 合并下次），`verdict = 'confirm_first'`，工具不替人选。
4. **缺数据就不算，且说出来。** 他仓没有自己的生产表需求就不算调拨；在途已逾期未决就不算有效在途——都写进 `flags[]` 让用户看见，而不是静默取默认值。
5. **来不及不静默。** 倒推得出最晚下单日已过 / 今天已过接单截止时，`ok = false` 并给两条备选：加急周期能否赶上、今天下单最早何时到。
6. **日期按工作日口径，节假日内置。** `calendar.ts` 内置当年法定节假日与调休上班日，支持在设置里追加；供应商自己的停产期作为参数传入。
7. **纯函数可测。** 每个工具的业务函数有独立 vitest 用例（`src/tools/*.test.ts`），不依赖 DOM 或网络。

---

## 8. 实现状态（2026-09-03）

| 模块 | 状态 |
|---|---|
| 脚手架、设置页（端点 / Key / 模型 / 公司五问）、流式对话、Pages 工作流、隐私守卫 CI | ✅ |
| 9 个工具全部注册：`search_knowledge` `lookup_material` `calc_order_qty` `backward_schedule` `check_po` `arrival_notice` `track_status` `save_summary` `save_enhancement` | ✅（73 个 vitest 用例） |
| 内置知识：7 篇 md → 38 张 builtin 卡，首启 `seedBuiltinCards` 幂等种入；系统提示只注入**目录**，正文由 `search_knowledge` 按需检索 | ✅ |
| 用户教的卡：模型出草稿 → `EnhancementPreview` 确认 → 落库；触发词重叠 → 并列标黄、用户拍板 | ✅ |
| 会话持久化与恢复（`state.messages` ⇄ IndexedDB）、事件小结 | ✅ |
| 资料导入（CSV / xlsx 懒加载 SheetJS，UTF-8 → GB18030 回退，二次导入差异摘要） | ✅ |
| 导出：全量 JSON（剔除 Key，资料可选）/ 单会话 Markdown / 增强卡 JSON；导入合并 | ✅ |
| 👍👎 反馈、工具结果「已采用」（北极星辅助指标） | ✅ |
| 真实模型端到端验收、移动端布局、对话内 L1 触发词预匹配 | ⏳ |

## 9. 已知取舍与停车场

| 取舍 | 现状 | 何时重新考虑 |
|---|---|---|
| **增强卡全量注入 vs 小模型意图路由** | 全量注入。少一次往返、少一层出错，卡 < 15 张时 token 可接受 | 卡 > 15 张，或单轮输入 token 明显影响延迟 / 成本 |
| **本地 BM25 + 中文字 bigram vs 向量检索** | 计划走 BM25，内置知识 < 1 MB，零网络零模型 | 用户资料量上到几万行、关键词召回明显不够时再评估 transformers.js |
| **只在浏览器 vs 云同步** | 明确不做。换设备 = 手动导出 / 导入 | 出现第二个真实用户、或同一用户多设备成为高频诉求 |
| **Cloudflare Worker 代理** | 只因 Coding Plan 端点 CORS 不放行 Authorization 才需要；标准端点可直连 | 上游放开 CORS 后可直接删掉这一层 |
| **Preact 而非 React** | 体积优先，React 语义能无缝迁移 | 需要 React 生态里某个 Preact 兼容不了的库时 |
| **增强卡自动覆盖 / builtin 版本管理 / 卡片打分** | 停车场 | 卡片数量或冲突频率上来之后 |
| **多用户 / 服务端存储 / 直连 U8 / 语音 / 移动端原生** | v1 明确不做 | —— |
