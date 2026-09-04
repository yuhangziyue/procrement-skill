// 「你的盲区」+「纠错闭环」两个工具（需求 7 / 8）。
// 写法沿用 save-enhancement.ts：TypeBox 参数 schema + 草稿回调，确认权在人。
//
// note_blindspot     ：静默记一条盲区。**不打断当前回答、不在对话里说教**。判定标准见 docs/DESIGN-blindspots.md §一。
// record_correction  ：用户说「这答案不对」并给出正确说法后，落成一张增强卡草稿（origin:"taught"），
//                      卡里标注「来源：用户补充 · YYYY-MM-DD」，走既有 EnhancementPreview 确认后才落库。
import { Type, type Static } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { EnhancementDraft } from "../db/enhancements";
import {
  KIND_LABEL,
  canonicalTopic,
  isRecordable,
  noteBlindspot,
  shouldRecordUnknown,
  suggestPlanItems,
  topicLabel,
  type BlindspotInput,
  type BlindspotKind,
} from "../learning/blindspots";
import { loadBlindspots } from "../learning/blindspots";

// ---------------------------------------------------------------------------
// 订阅口：UI 侧监听
// ---------------------------------------------------------------------------

/** 盲区列表变了（静默入库后），「你的盲区」tab 据此刷新 */
export type BlindspotChangeListener = () => void;
const changeListeners = new Set<BlindspotChangeListener>();
export function onBlindspotChange(fn: BlindspotChangeListener): () => void {
  changeListeners.add(fn);
  return () => changeListeners.delete(fn);
}

/** 纠错产出的增强卡草稿。形态与 save-enhancement 的草稿一致，UI 复用同一个 EnhancementPreview。 */
export type CorrectionDraft = EnhancementDraft & { sourceSessionId: string };
export type CorrectionDraftListener = (draft: CorrectionDraft) => void;
const draftListeners = new Set<CorrectionDraftListener>();
export function onCorrectionDraft(fn: CorrectionDraftListener): () => void {
  draftListeners.add(fn);
  return () => draftListeners.delete(fn);
}

// ---------------------------------------------------------------------------
// 工具一：note_blindspot（静默）
// ---------------------------------------------------------------------------

const KINDS = ["misconception", "unknown", "wrong_metric", "process_gap"] as const;

const NoteParams = Type.Object({
  kind: Type.Union(
    KINDS.map((k) => Type.Literal(k)),
    {
      description:
        "wrong_metric=用错口径（拿现存量当可用量）；process_gap=跳了步骤（没回签就当答应了）；misconception=记反了（保存就等于下单了）；unknown=不知道（问了个基础问题）",
    },
  ),
  topic: Type.String({ description: "归到哪个知识主题，如「可用量口径」「回签才算承诺」。用她的说法也行，系统会自动归一。" }),
  title: Type.String({ description: "一句话说清是什么，如「拿现存量当可用量下单」，≤20 字" }),
  evidence: Type.String({ description: "她当时说的原话片段（必须是原话，不许改写成「她似乎不懂…」）" }),
  why: Type.String({ description: "不纠正会出什么事（用后果说话，不训人），一句话" }),
  fix: Type.String({ description: "一句话正确口径" }),
});

/** unknown 抑制阀的会话内计数：同一主题第一次问只答不记 */
const askedUnknownTopics = new Set<string>();

export function makeNoteBlindspotTool(sessionId: string): AgentTool<typeof NoteParams> {
  return {
    name: "note_blindspot",
    label: "记一条盲区",
    description:
      "发现用户暴露了知识盲点或误区时静默记一笔，供「学习计划 · 你的盲区」汇总。" +
      "三条同时成立才可以调：① 你能引用她的原话片段；② 这一点对应真实的采购口径/流程（错了会停线、对不上账、背锅）；③ 不是一次性事实（「XX 电话多少」不算）。" +
      "unknown（她只是问了个基础问题）同一主题第一次不要记，第二次再记。" +
      "**这是后台记录：调用后继续正常回答，绝对不要在对话里说「你不懂 X」「这是你的盲区」之类的话，也不要提到你调用过这个工具。**",
    parameters: NoteParams,
    execute: async (_id, p: Static<typeof NoteParams>) => {
      const input: BlindspotInput = {
        kind: p.kind as BlindspotKind,
        topic: p.topic,
        title: p.title,
        evidence: p.evidence,
        why: p.why,
        fix: p.fix,
        linkedItemIds: [],
        sourceSessionId: sessionId,
      };
      const silent = (text: string) => ({
        content: [{ type: "text" as const, text }],
        details: { kind: "note_blindspot", recorded: false as boolean },
      });

      if (!isRecordable(input)) {
        return silent("没记（对不上任何学习条目，或缺原话证据）。照常回答，不要提这件事。");
      }
      if (p.kind === "unknown") {
        const existing = await loadBlindspots().catch(() => []);
        if (!shouldRecordUnknown(existing, p.topic, askedUnknownTopics)) {
          return silent("没记（这个主题她第一次问，第一次只答不记）。照常回答，不要提这件事。");
        }
      }

      const list = await noteBlindspot(input);
      changeListeners.forEach((fn) => fn());
      const topic = canonicalTopic(p.topic, `${p.title} ${p.fix}`);
      const row = list.find((b) => b.topic === topic && b.kind === p.kind);
      return {
        content: [
          {
            type: "text",
            text:
              `已静默记入「你的盲区」：${KIND_LABEL[p.kind as BlindspotKind]} · ${topicLabel(topic)}` +
              `（第 ${row?.occurrences ?? 1} 次）。**继续正常回答，不要在对话里提这条记录。**`,
          },
        ],
        details: { kind: "note_blindspot", recorded: true, id: row?.id, topic, occurrences: row?.occurrences ?? 1 },
      };
    },
  };
}

// ---------------------------------------------------------------------------
// 工具二：record_correction（纠错闭环 → 增强卡草稿）
// ---------------------------------------------------------------------------

const CorrectionParams = Type.Object({
  wrong: Type.String({ description: "我们刚才哪一句说错了（摘她指出的那句，或你原答里的那句）" }),
  correct: Type.Optional(
    Type.String({ description: "她给的正确口径，一句话。**这是唯一必答项：她没说清楚就别填，宁可空着也不许自己编。**" }),
  ),
  name: Type.Optional(Type.String({ description: "卡名，≤20 字，如「日配件断料先查 B 仓」。不填就用主题自动生成。" })),
  triggers: Type.Optional(Type.Array(Type.String(), { description: "下次什么情况下按这条办（触发词 3~8 个）。她跳过就你来猜。" })),
  sop: Type.Optional(Type.Array(Type.String(), { description: "如果她讲了步骤，一条一步" })),
  topic: Type.Optional(Type.String({ description: "属于哪个知识主题，如「可用量口径」" })),
  today: Type.Optional(Type.String({ description: "今天 YYYY-MM-DD，默认系统日期" })),
});

/** YYYY-MM-DD（本地时区）。传进来的日期只在格式合法时采用。 */
export function sourceStamp(today?: string): string {
  if (today && /^\d{4}-\d{2}-\d{2}$/.test(today.trim())) return today.trim();
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 「用户补充」来源戳。EnhancementRow 没有 source 字段（不改表结构），塞进 cautions 末尾——
 *  cautions 会被 buildSystemPrompt 原样注入上下文，在「增强卡」面板里也直接可见，一处写入两处可见。 */
export const sourceLine = (today?: string): string => `来源：用户补充 · ${sourceStamp(today)}`;

/** 纯函数：把一次纠错拼成增强卡草稿（便于测试） */
export function buildCorrectionDraft(
  p: {
    wrong: string;
    correct: string;
    name?: string;
    triggers?: string[];
    sop?: string[];
    topic?: string;
    today?: string;
  },
  sessionId: string,
): CorrectionDraft {
  const topic = canonicalTopic(p.topic ?? "", `${p.correct} ${p.wrong}`);
  const label = topic ? topicLabel(topic) : "";
  const name = (p.name?.trim() || (label ? `${label}（用户补充）` : p.correct.trim().slice(0, 18))).slice(0, 24);
  const triggers = (p.triggers ?? []).map((t) => t.trim()).filter(Boolean);
  return {
    name,
    intents: [label ? `${label}相关的问题，按用户教的口径回答` : "按用户教的正确口径回答"],
    triggers: triggers.length ? triggers : [label || name].filter(Boolean),
    sop: (p.sop ?? []).map((s) => s.trim()).filter(Boolean),
    // 第一条写死「正确口径」，最后一条写死来源戳——渲染进 system prompt 时这两句都在
    cautions: [
      `正确口径：${p.correct.trim()}`,
      `曾答错：${p.wrong.trim()}——不要再这么说`,
      sourceLine(p.today),
    ],
    examples: [],
    enabled: true,
    origin: "taught",
    sourceSessionId: sessionId,
  };
}

export function makeRecordCorrectionTool(sessionId: string): AgentTool<typeof CorrectionParams> {
  return {
    name: "record_correction",
    label: "纠错（存成规矩）",
    description:
      "用户说「这答案不对 / 不是这样的」时用它把正确口径固化下来。" +
      "问法是死的：一次只问一件事，最多三问 —— ①哪一句不对（可跳）→ ②正确的应该是什么（唯一必答）→ ③下次什么情况下按这条办（可跳）。" +
      "拿到 ② 才调用本工具；**②她说不清楚就把 correct 留空调用，工具会告诉你怎么收场，绝对不许自己编一个正确答案**。" +
      "调用后卡片草稿会弹给用户确认，你只需说一句「记下了，确认后下次就按这条办」。",
    parameters: CorrectionParams,
    execute: async (_id, p: Static<typeof CorrectionParams>) => {
      const correct = p.correct?.trim() ?? "";
      if (!correct) {
        return {
          content: [
            {
              type: "text",
              text:
                "没有拿到正确口径，这次不落卡，也不要自己编。" +
                "跟她说一句「那我先不记，等你想到正确说法随时告诉我」，然后继续原来的事，别再追问第四遍。",
            },
          ],
          details: { kind: "record_correction", saved: false },
        };
      }
      const draft = buildCorrectionDraft({ ...p, correct }, sessionId);
      draftListeners.forEach((fn) => fn(draft));
      return {
        content: [
          {
            type: "text",
            text:
              `已生成增强卡草稿「${draft.name}」（触发词：${draft.triggers.join("、")}），` +
              `卡里标了「${sourceLine(p.today)}」。告诉用户：确认后下次就按这条办。`,
          },
        ],
        details: { kind: "record_correction", saved: false, draft },
      };
    },
  };
}

/** 纠错时顺手给一句「这条规矩对应哪几条学习条目」，UI 可用来做跳转（不参与落库） */
export function correctionRelatedItems(correct: string, topic?: string): string[] {
  return suggestPlanItems({ topic: topic ?? "", title: correct, fix: correct, evidence: correct });
}
