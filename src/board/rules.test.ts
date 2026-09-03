// 排序与硬规则 R1~R4 的回归测试。最要紧的一条是 R4：**排序必须稳定**——
// 她昨天记住的顺序今天不能莫名其妙变，所以打乱输入两次，输出必须一模一样。
import { describe, expect, it } from "vitest";
import { compareTasks, groupMatesOf, groupOpeningLine, rankTasks, TOP_N } from "./rules";
import type { BoardTask, TaskKind } from "./types";

let seq = 0;
function card(p: Partial<BoardTask> & { id: string; score: number }): BoardTask {
  const kind: TaskKind = p.kind ?? "T5_transit";
  return {
    id: p.id, kind, stage: p.stage ?? "transit", status: p.status ?? "todo",
    title: p.title ?? `盯 ${p.id}`, materialCode: p.materialCode, materialName: p.materialName,
    supplier: p.supplier, poNo: p.poNo, qty: p.qty, needDate: p.needDate, promiseDate: p.promiseDate,
    dueDate: p.dueDate, score: p.score, reasons: [], steps: [], doneSteps: [],
    doneRule: "已闭环", escalation: "找领导", bizDate: "2026-09-03",
    createdAt: ++seq, updatedAt: seq, closedAt: null,
  };
}

/** 一副真实感的牌：三拼腰封逾期、纸盒待回签、纸托在途、贴纸补货 */
const deck = (): BoardTask[] => [
  card({ id: "b-纸盒A", score: 62, kind: "T4_unconfirmed", stage: "confirm", supplier: "样例纸品", materialCode: "11101011", materialName: "彩印纸盒A", needDate: "2026-09-10", poNo: "PO26-0871" }),
  card({ id: "a-三拼腰封", score: 182.1, kind: "T8_overdue", supplier: "示例包材", materialCode: "1110919", materialName: "三拼腰封AL", needDate: "2026-09-04", poNo: "PO26-0863" }),
  card({ id: "d-单片贴纸", score: 22, kind: "T5_transit", supplier: "样例纸品", materialCode: "1107859", materialName: "单片贴纸", needDate: "2026-09-22", poNo: "PO26-0880" }),
  card({ id: "c-纸托", score: 62, kind: "T5_transit", supplier: "示例包材", materialCode: "11101016", materialName: "内衬纸托", needDate: "2026-09-08", poNo: "PO26-0874" }),
];

const shuffle = <T,>(a: T[], seedStart: number) => {
  const r = [...a];
  let s = seedStart;
  for (let i = r.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) % 2147483648;
    const j = s % (i + 1);
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
};

describe("R4 稳定排序", () => {
  it("打乱输入两次，输出顺序一模一样", () => {
    const one = rankTasks(shuffle(deck(), 7)).ordered.map((t) => t.id);
    const two = rankTasks(shuffle(deck(), 991)).ordered.map((t) => t.id);
    const three = rankTasks(deck()).ordered.map((t) => t.id);
    expect(one).toEqual(two);
    expect(two).toEqual(three);
  });

  it("分高的在前：三拼腰封（R1 置顶 182）排第一", () => {
    expect(rankTasks(deck()).ordered[0].id).toBe("a-三拼腰封");
  });

  it("同分 62 的两张：按需求日升序，纸托 09-08 在纸盒 09-10 前面", () => {
    const ids = rankTasks(deck()).ordered.map((t) => t.id);
    expect(ids.indexOf("c-纸托")).toBeLessThan(ids.indexOf("b-纸盒A"));
  });

  it("同分同需求日：按物料编码升序兜底", () => {
    const t = [
      card({ id: "x", score: 50, needDate: "2026-09-09", materialCode: "11101016" }),
      card({ id: "y", score: 50, needDate: "2026-09-09", materialCode: "1107859" }),
    ];
    expect(rankTasks(t).ordered.map((c) => c.materialCode)).toEqual(["1107859", "11101016"]);
    expect(rankTasks([t[1], t[0]]).ordered.map((c) => c.materialCode)).toEqual(["1107859", "11101016"]);
  });

  it("compareTasks 自比为 0，且是全序（任意两张都能定出先后）", () => {
    const d = deck();
    expect(compareTasks(d[0], d[0])).toBe(0);
    for (const a of d) for (const b of d) if (a.id !== b.id) expect(compareTasks(a, b)).not.toBe(0);
  });

  it("干完的卡沉到后面，作废的垫底——不再占她的注意力", () => {
    const t = [
      card({ id: "done-高分", score: 300, status: "done" }),
      card({ id: "dropped-高分", score: 400, status: "dropped" }),
      card({ id: "todo-低分", score: 5 }),
    ];
    expect(rankTasks(t).ordered.map((c) => c.id)).toEqual(["todo-低分", "done-高分", "dropped-高分"]);
  });
});

describe("R3 今天三件事最多 3 张", () => {
  it("4 张活卡只推 3 张，第 4 张折回泳道", () => {
    const r = rankTasks(deck());
    expect(r.top3).toHaveLength(TOP_N);
    expect(r.ordered).toHaveLength(4);
    expect(r.top3.map((t) => t.id)).toEqual(["a-三拼腰封", "c-纸托", "b-纸盒A"]);
  });

  it("已经干完的卡不进「今天三件事」", () => {
    const t = deck().map((c) => (c.id === "a-三拼腰封" ? { ...c, status: "done" as const } : c));
    expect(rankTasks(t).top3.map((x) => x.id)).not.toContain("a-三拼腰封");
  });

  it("一张卡都没有时 top3 是空数组，不报错", () => {
    expect(rankTasks([])).toEqual({ ordered: [], top3: [], groups: [] });
  });
});

describe("R2 同供应商合并成一次沟通", () => {
  it("同一供应商 ≥2 张要沟通的卡打成一组，但卡一张都不少", () => {
    const r = rankTasks(deck());
    expect(r.ordered).toHaveLength(4);
    const shi = r.groups.find((g) => g.supplier === "示例包材")!;
    expect(shi.taskIds).toEqual(["a-三拼腰封", "c-纸托"]);
  });

  it("组间按组内最高分排：时进（182）在恒达（62）前面", () => {
    expect(rankTasks(deck()).groups.map((g) => g.supplier)).toEqual(["示例包材", "样例纸品"]);
  });

  it("下单类不并组——那是自己在 U8 里干的活，不进同一通电话", () => {
    const t = [
      card({ id: "o1", score: 70, kind: "T1_shortage", stage: "order", supplier: "示例包材" }),
      card({ id: "o2", score: 60, kind: "T1_shortage", stage: "order", supplier: "示例包材" }),
    ];
    expect(rankTasks(t).groups).toHaveLength(0);
  });

  it("只有一张卡的供应商不成组", () => {
    const only = deck().filter((c) => c.supplier === "样例纸品").slice(0, 1);
    expect(rankTasks(only).groups).toHaveLength(0);
  });

  it("groupMatesOf 给出「顺带能一起问的那几张」", () => {
    const r = rankTasks(deck());
    expect(groupMatesOf("a-三拼腰封", r.groups)).toEqual(["c-纸托"]);
    expect(groupMatesOf("d-单片贴纸", r.groups)).toEqual(["b-纸盒A"]); // 恒达那两笔一通电话一起问
    expect(groupMatesOf("不存在的卡", r.groups)).toEqual([]);
  });

  it("合并沟通的开场白点名到每一笔，不说「跟进一下」", () => {
    const d = deck().filter((c) => c.supplier === "示例包材");
    const line = groupOpeningLine("示例包材", d);
    expect(line).toContain("PO26-0863");
    expect(line).toContain("三拼腰封AL");
    expect(line).not.toContain("跟进一下");
  });
});
