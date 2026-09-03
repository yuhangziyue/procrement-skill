import type { CompanyConfig } from "../db/settings";
import type { EnhancementRow } from "../db/schema";

/** 小采人设 + 执行原则。知识与 SOP 通过增强卡注入，这里只放不变的部分。 */
const PERSONA = `你是「小采」，一位在制造业供应链干了 18 年的采购师姐，用友 U8 从实施用到精通，带出过三批新人。
你现在带的是刚转岗的采购新人。你不在对方公司里：不能替她签字、找仓库、开会、担责任——所以永远不说「我陪你 / 我替你 / 我来担」。
你能给的只有三样：具体的知识点、具体的做法步骤、具体的开口话术，让她自己去做、去问、去让成绩被看见。

说话规矩（每条都要守）：
1. 每个专业术语第一次出现都跟一句白话解释；同一个词问十遍答十遍，不表现出不耐烦。
2. 给方案让她定：算量、选供应商这类决策给两个版本让她选，她选了就照她的走。
3. 选择题代替开放题：她说不清时，用「是 A 还是 B」一路问下去。
4. 一次只讲一件事，并附上工具（清单 / 模板 / 表格），不要求她自己发明流程。
5. 推不动就换轨，不加力：给另一条路的具体样子，不说「再催催」。
6. 出了错只讲「下次怎么做」，不讲「你怎么错的」。
7. 认可要具体到事，并接一句「这个要让谁知道、怎么说」（当天一条消息 / 周五三句话周报）。

硬规矩：
- 算账（净缺口、MOQ 凑整、交期倒推、三色判定）一律调用工具，不口算；把工具给的算式原样展示给她，方便贴进 PO 备注留痕。
- 涉及 U8 菜单路径、单据名、税率的回答，如果公司配置未填，必须在句尾标「⚠️ 待实机核对」。
- 口诀：无单不采，无签不认，无验不收；先算账，再下单；书面为准，口头不算。
- 不知道就说不知道，并告诉她该去问谁、开口第一句怎么说。`;

export function buildSystemPrompt(company: CompanyConfig, cards: EnhancementRow[]): string {
  const parts = [PERSONA];

  const cfgLines = [
    ["用友产品与版本", company.product],
    ["是否走请购单", company.requisition],
    ["有无到货单环节 / 质检", company.arrivalDoc],
    ["采购员权限边界", company.permission],
    ["跟踪用的报表名", company.trackingReport],
  ];
  const missing = cfgLines.filter(([, v]) => !v?.trim()).map(([k]) => k);
  parts.push(
    `## 公司配置（用户填写）\n` +
      cfgLines.map(([k, v]) => `- ${k}：${v?.trim() || "（未填）"}`).join("\n") +
      (missing.length
        ? `\n未填项：${missing.join("、")}。凡涉及这些的回答，句尾必须带「⚠️ 待实机核对」，并提示她去问系统管理员/老采购，给出开口话术。`
        : "\n配置齐全，按配置回答，不再加 ⚠️。"),
  );

  const enabled = cards.filter((c) => c.enabled);
  const taught = enabled.filter((c) => c.origin !== "builtin");
  const builtin = enabled.filter((c) => c.origin === "builtin");

  if (taught.length) {
    parts.push(
      `## 用户教给你的规矩（${taught.length} 张，优先级高于内置知识，命中就照办）\n` +
        taught
          .map(
            (c) =>
              `### ${c.name}\n意图：${c.intents.join(" / ")}\n触发词：${c.triggers.join("、")}\n` +
              (c.sop.length ? `流程：\n${c.sop.map((s, i) => `${i + 1}. ${s}`).join("\n")}\n` : "") +
              (c.cautions.length ? `注意：\n${c.cautions.map((s) => `- ${s}`).join("\n")}\n` : "") +
              (c.examples.length ? `示例：\n${c.examples.map((s) => `- ${s}`).join("\n")}` : ""),
          )
          .join("\n\n"),
    );
  }

  if (builtin.length) {
    // 只给目录：正文靠 search_knowledge 按需取，避免每轮把几十张卡全塞进上下文
    parts.push(
      `## 内置知识目录（${builtin.length} 张卡，正文用 search_knowledge 检索后再答）\n` +
        builtin.map((c) => `- ${c.name}｜${c.triggers.slice(0, 6).join("、")}`).join("\n"),
    );
  }

  return parts.join("\n\n");
}
