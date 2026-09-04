// 收工判定的回归测试。判据只有采姐那一句：**允许「未闭环」，不允许「没交代」。**
import { describe, expect, it } from "vitest";
import { evaluateDay, evidenceDone, handoverText } from "./day";
import type { BoardTask, TaskKind } from "./types";

const BIZ = "2026-09-03";
let seq = 0;
function card(kind: TaskKind, p: Partial<BoardTask> = {}): BoardTask {
  return {
    id: p.id ?? `${kind}|${++seq}|${BIZ}`, kind, stage: "to_order", status: p.status ?? "todo",
    band: p.band ?? "follow", bandRule: p.bandRule ?? "F6", bandWhy: p.bandWhy ?? "今天推进一步",
    primaryAction: p.primaryAction ?? {
      id: "done_it", label: "干完了 →", actionKind: "record",
      evidence: [{ key: "proof", label: "凭据", type: "text", required: true }],
    },
    editable: p.editable ?? {}, events: p.events ?? [], doneEvidence: p.doneEvidence,
    title: p.title ?? `处理 ${kind}`, materialCode: p.materialCode, materialName: p.materialName,
    supplier: p.supplier, poNo: p.poNo, qty: p.qty, needDate: p.needDate, dueDate: p.dueDate,
    score: p.score ?? 50, reasons: [], steps: [], doneSteps: p.doneSteps ?? [],
    doneRule: "已闭环", escalation: "找领导", note: p.note, bizDate: BIZ,
    createdAt: 1, updatedAt: 1, closedAt: null,
  };
}
const item = (r: ReturnType<typeof evaluateDay>, id: string) => r.items.find((i) => i.id === id)!;

describe("八条收工清单", () => {
  it("八条一条不少，顺序与采姐 §4 一致，最后一条是收工三句话", () => {
    const r = evaluateDay([], {}, BIZ);
    expect(r.items).toHaveLength(8);
    expect(r.items[r.items.length - 1].id).toBe("handover");
  });

  it("一张卡都没有时七条自动项自动满足，但三句话没发就不能收工", () => {
    const r = evaluateDay([], {}, BIZ);
    expect(item(r, "shortage_cleared").satisfied).toBe(true);
    expect(item(r, "handover").satisfied).toBe(false);
    expect(r.canClose).toBe(false);
  });

  it("勾了「已发」才收得了工——小采不替她按对外的按钮", () => {
    expect(evaluateDay([], { handover: true }, BIZ).canClose).toBe(true);
  });

  it("没有日配巡检卡时不拦着她收工，但 detail 说清 0 件是怎么来的", () => {
    const r = evaluateDay([], {}, BIZ);
    expect(item(r, "daily_water").satisfied).toBe(true);
    expect(item(r, "daily_water").detail).toContain("在购-日配");
  });
});

describe("允许未闭环，不允许没交代", () => {
  it("下单卡没下也没写原因 → 不算完，detail 点名是哪几张", () => {
    const r = evaluateDay([card("T1_shortage", { materialName: "彩印纸盒A" })], {}, BIZ);
    expect(item(r, "shortage_cleared").satisfied).toBe(false);
    expect(item(r, "shortage_cleared").detail).toContain("彩印纸盒A");
    expect(item(r, "shortage_cleared").detail).toContain("明天几点动");
  });

  it("下单卡没下但写清了卡在谁那里 → 算完", () => {
    const r = evaluateDay([card("T1_shortage", { materialName: "彩印纸盒A", note: "卡在生产王主任确认改期，明早 9:00 再追" })], {}, BIZ);
    expect(item(r, "shortage_cleared").satisfied).toBe(true);
    expect(item(r, "shortage_cleared").detail).toContain("写清了原因");
  });

  it("空白备注不算交代", () => {
    const r = evaluateDay([card("T1_shortage", { note: "  " })], {}, BIZ);
    expect(item(r, "shortage_cleared").satisfied).toBe(false);
  });

  it("卡已 done 自然算完；作废的卡不参与判定", () => {
    const done = evaluateDay([card("T1_shortage", { status: "done" })], {}, BIZ);
    const dropped = evaluateDay([card("T1_shortage", { status: "dropped" })], {}, BIZ);
    expect(item(done, "shortage_cleared").satisfied).toBe(true);
    expect(item(dropped, "shortage_cleared").detail).toContain("没有要下的单");
  });

  it("未回签的单：催过一轮（记了一笔）就算数——对方不回不是她的错", () => {
    const chased = evaluateDay([card("T4_unconfirmed", {
      events: [{ id: "e1", taskId: "x", at: BIZ, channel: "微信", content: "催了一轮，对方说明早给回签" }],
    })], {}, BIZ);
    const idle = evaluateDay([card("T4_unconfirmed")], {}, BIZ);
    expect(item(chased, "confirm_chased").satisfied).toBe(true);
    expect(item(idle, "confirm_chased").satisfied).toBe(false);
    expect(item(idle, "confirm_chased").detail).toContain("48 小时");
  });

  it("逾期件：光记一笔不算，必须闭环或写清已通知生产", () => {
    const acted = evaluateDay([card("T8_overdue", {
      events: [{ id: "e1", taskId: "x", at: BIZ, channel: "电话", content: "打过了" }],
    })], {}, BIZ);
    expect(item(acted, "overdue_escalated").satisfied).toBe(false);
    expect(item(acted, "overdue_escalated").detail).toContain("只打电话没通知生产");
  });

  it("到货预告只认闭环：没拿到仓库回执就是没发出", () => {
    const r = evaluateDay([card("T6_notice")], {}, BIZ);
    expect(item(r, "notice_sent").satisfied).toBe(false);
    expect(item(r, "notice_sent").detail).toContain("没人回 = 没发出");
    expect(item(evaluateDay([card("T6_notice", { status: "done" })], {}, BIZ), "notice_sent").satisfied).toBe(true);
  });

  it("差异件和到货未入库合在一条判，拖过三天就说不清", () => {
    const r = evaluateDay([card("T9_discrepancy", { materialName: "内衬纸托" }), card("T7_not_stocked", { status: "done" })], {}, BIZ);
    expect(item(r, "discrepancy_filed").satisfied).toBe(false);
    expect(item(r, "discrepancy_filed").detail).toContain("内衬纸托");
  });

  it("她手动勾上的自动项一律尊重（系统判不出来的事不能拦着她收工）", () => {
    const tasks = [card("T1_shortage")];
    expect(item(evaluateDay(tasks, {}, BIZ), "shortage_cleared").satisfied).toBe(false);
    expect(item(evaluateDay(tasks, { shortage_cleared: true }, BIZ), "shortage_cleared").satisfied).toBe(true);
  });

  it("不是今天的卡不参与今天的判定", () => {
    const old = { ...card("T1_shortage"), bizDate: "2026-09-02" };
    expect(item(evaluateDay([old], {}, BIZ), "shortage_cleared").detail).toContain("没有要下的单");
  });

  it("八条全绿 + 三句话已发 → 可以收工", () => {
    const tasks = [
      card("T10_daily_check", { status: "done" }),
      card("T1_shortage", { status: "done" }),
      card("T6_notice", { status: "done" }),
    ];
    const r = evaluateDay(tasks, { handover: true }, BIZ);
    expect(r.items.filter((i) => !i.satisfied)).toEqual([]);
    expect(r.canClose).toBe(true);
  });
});

describe("收工三句话：做了什么 / 卡在哪 / 明天要什么", () => {
  const tasks = [
    card("T1_shortage", { status: "done", materialName: "彩印纸盒A", qty: 6000 }),
    card("T2_addon", { status: "done", materialName: "单片贴纸" }),
    card("T8_overdue", { status: "done", materialName: "三拼腰封AL", supplier: "示例包材" }),
    card("T6_notice", { status: "done" }),
    card("T4_unconfirmed", { materialName: "内衬纸托", supplier: "样例纸品", score: 70 }),
    card("T1B_late", { materialName: "瓦楞隔板", score: 90, note: "等王主任决定改不改计划" }),
  ];

  it("三句话带具体数字和物料名，不是套话", () => {
    const s = handoverText(tasks, BIZ);
    expect(s).toContain("9/3");
    expect(s).toContain("下了 2 张单");
    expect(s).toContain("彩印纸盒A");
    expect(s).toContain("拦下 1 处");
    expect(s).toContain("到货预告");
  });

  it("第二句点名卡在哪、等谁——最高分的那条排第一", () => {
    const s = handoverText(tasks, BIZ);
    expect(s).toContain("还卡着 2 条");
    expect(s).toContain("瓦楞隔板（等王主任决定改不改计划）");
    expect(s).toContain("样例纸品");
  });

  it("第三句给领导选择题，不给问答题", () => {
    const s = handoverText(tasks, BIZ);
    expect(s).toContain("要您拍一下板");
    expect(s).toContain("走加急加钱，还是让生产挪计划");
  });

  it("没有要拍板的事时，第三句说清明早先追哪条", () => {
    const s = handoverText([card("T4_unconfirmed", { materialName: "内衬纸托" })], BIZ);
    expect(s).toContain("明天一早我先追内衬纸托");
  });

  it("全清完的一天也有话说，不空着", () => {
    const s = handoverText([card("T1_shortage", { status: "done", materialName: "彩印纸盒A" })], BIZ);
    expect(s).toContain("今天的事都闭环了");
    expect(s).toContain("明天按计划走");
  });

  it("一条卡都没有也能生成，不出现 undefined / NaN", () => {
    const s = handoverText([], BIZ);
    expect(s.length).toBeGreaterThan(10);
    expect(s).not.toMatch(/undefined|NaN/);
  });

  it("evaluateDay 直接把三句话带出来，界面不用再拼", () => {
    expect(evaluateDay(tasks, {}, BIZ).handoverText).toBe(handoverText(tasks, BIZ));
  });
});

describe("完成判定改为程序判定：凭据填齐才算干完（v2）", () => {
  const evCard = (p: Partial<BoardTask> = {}) => card("T1_shortage", {
    primaryAction: {
      id: "po_created", label: "已在 U8 开单 →", actionKind: "u8",
      evidence: [
        { key: "poNo", label: "U8 订单号", type: "text", required: true },
        { key: "audited", label: "已点审核", type: "checkbox", required: true },
      ],
    },
    ...p,
  });

  it("必填凭据全填齐 → 算干完，不用她再点一次「干完了」", () => {
    expect(evidenceDone(evCard({ doneEvidence: { poNo: "PO26-0901", audited: "1" } }))).toBe(true);
  });

  it("只填了一格 → 不算干完（保存 ≠ 生效，这一格就是那句话的落点）", () => {
    expect(evidenceDone(evCard({ doneEvidence: { poNo: "PO26-0901" } }))).toBe(false);
  });

  it("空白字符串不算填", () => {
    expect(evidenceDone(evCard({ doneEvidence: { poNo: "  ", audited: "1" } }))).toBe(false);
  });

  it("选填那格空着不影响完成", () => {
    const t = card("T7_not_stocked", {
      primaryAction: {
        id: "instock", label: "催到入库单 →", actionKind: "call",
        evidence: [
          { key: "stockedOk", label: "累计入库增量 = 实到量", type: "checkbox", required: true },
          { key: "whoPromised", label: "仓库谁答应几点录", type: "text", required: false },
        ],
      },
      doneEvidence: { stockedOk: "1" },
    });
    expect(evidenceDone(t)).toBe(true);
  });

  it("勾了一堆步骤但凭据没填 → 仍然不算干完（doneSteps 不再参与判定）", () => {
    const t = evCard({ doneSteps: ["s1", "s2", "s3"] });
    expect(evidenceDone(t)).toBe(false);
    expect(item(evaluateDay([t], {}, BIZ), "shortage_cleared").satisfied).toBe(false);
  });

  it("凭据填齐的下单卡进收工清单的「已下单」计数", () => {
    const r = evaluateDay([evCard({ doneEvidence: { poNo: "PO26-0901", audited: "1" } })], {}, BIZ);
    expect(item(r, "shortage_cleared").satisfied).toBe(true);
    expect(item(r, "shortage_cleared").detail).toContain("1 张已下单");
  });
});
