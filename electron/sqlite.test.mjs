// 桌面端 SQLite 层的回归测试。这层跑在 Electron 主进程里（node:sqlite），
// 用 node 直接测就够——不需要起 Electron，坏了能立刻看出是 SQL 还是业务的问题。
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDb, tablePut, tableGet, tableByIndex, tableAll, tableUpdate, tableDelete, tableDeleteByIndex } from "./db.mjs";
import * as F from "./features.mjs";

const file = path.join(os.tmpdir(), `xiaocai-test-${Date.now()}.sqlite`);
beforeAll(() => openDb(file));
afterAll(() => { for (const s of ["", "-wal", "-shm"]) { try { fs.rmSync(file + s); } catch { /* 可能没生成 */ } } });

describe("Dexie 兼容层的服务端实现", () => {
  it("写入、按主键读、按索引读", () => {
    tablePut("sessions", [
      { id: "s1", title: "会话一", createdAt: 1, updatedAt: 10, tags: [] },
      { id: "s2", title: "会话二", createdAt: 2, updatedAt: 20, tags: ["a"] },
    ]);
    tablePut("messages", [{ id: "m1", sessionId: "s1", role: "user", content: { a: 1 }, createdAt: 5 }]);
    expect(tableGet("sessions", "s1").title).toBe("会话一");
    expect(tableAll("sessions")).toHaveLength(2);
    expect(tableByIndex("messages", "sessionId", "s1")).toHaveLength(1);
    // 嵌套对象/数组要原样回来（走 data JSON 列）
    expect(tableByIndex("messages", "sessionId", "s1")[0].content).toEqual({ a: 1 });
  });

  it("布尔索引列存成 0/1 仍可按 true 查——IndexedDB 上正是这里静默返回空数组", () => {
    tablePut("enhancements", [
      { id: "e1", name: "卡1", origin: "builtin", enabled: true, conflictsWith: [], createdAt: 1, updatedAt: 1 },
      { id: "e2", name: "卡2", origin: "user", enabled: false, conflictsWith: [], createdAt: 1, updatedAt: 1 },
    ]);
    expect(tableByIndex("enhancements", "enabled", true)).toHaveLength(1);
    expect(tableByIndex("enhancements", "enabled", false)[0].id).toBe("e2");
    expect(tableByIndex("enhancements", "origin", "builtin")[0].name).toBe("卡1");
  });

  it("update 是读改写合并，不是整行覆盖", () => {
    tableUpdate("sessions", "s1", { title: "改名" });
    expect(tableGet("sessions", "s1")).toMatchObject({ title: "改名", createdAt: 1, tags: [] });
    expect(tableUpdate("sessions", "不存在", { title: "x" })).toBe(0);
  });

  it("按主键删 / 按索引批量删", () => {
    expect(tableDeleteByIndex("messages", "sessionId", "s1")).toBe(1);
    expect(tableAll("messages")).toHaveLength(0);
    tableDelete("sessions", ["s2"]);
    expect(tableAll("sessions")).toHaveLength(1);
  });

  it("settings 的主键是 key 不是 id", () => {
    tablePut("settings", [{ key: "llm", value: { model: "doubao" } }]);
    expect(tableGet("settings", "llm").value.model).toBe("doubao");
  });
});

describe("知识库：中文 bigram + FTS5", () => {
  it("切 bigram：中文两两成对，英文数字整体保留", () => {
    expect(F.toGrams("采购入库")).toEqual(["采购", "购入", "入库"]);
    expect(F.toGrams("PO-2026 到货")).toEqual(["po-2026", "到货"]);
    expect(F.toGrams("")).toEqual([]);
  });

  it("导入文档后能被中文查询命中，并可按分类过滤", () => {
    F.upsertDoc({ id: "d1", title: "采购制度", category: "policy", tags: [], charCount: 100, createdAt: 1, updatedAt: 1 });
    F.insertChunks("d1", [
      { id: "c1", seq: 0, heading: "请购流程", category: "policy", text: "请购单由生产部提出，采购部审核后转采购订单，金额超过五万需总经理审批。" },
      { id: "c2", seq: 1, heading: "到货入库", category: "inbound", text: "到货后仓库先做到货单，品质检验合格再生成采购入库单，暂估入库月末处理。" },
    ]);
    expect(F.listDocs()[0].chunkCount).toBe(2);
    const hits = F.searchChunks("采购入库单怎么做", { limit: 5 });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].heading).toBe("到货入库");
    expect(F.searchChunks("入库", { limit: 5, category: "inbound" })).toHaveLength(1);
    expect(F.searchChunks("完全不相干的词汇零零零")).toHaveLength(0);
  });

  it("重复导入同一块不会命中两次", () => {
    F.insertChunks("d1", [{ id: "c1", seq: 0, heading: "请购流程", category: "policy", text: "请购单由生产部提出。" }]);
    expect(F.searchChunks("请购单").filter((h) => h.chunkId === "c1")).toHaveLength(1);
  });

  it("删文档连带删切片与全文索引（contentless FTS5 会在这里报 SQL logic error）", () => {
    expect(F.deleteDoc("d1")).toBe(2);
    expect(F.searchChunks("入库")).toHaveLength(0);
    expect(F.listDocs()).toHaveLength(0);
  });
});

describe("看板与学习计划", () => {
  it("任务的 JSON 列往返不失真，update 合并", () => {
    F.upsertTasks([{
      id: "t1", kind: "shortage", title: "A料缺1700", stage: "order", status: "todo", score: 88,
      reasons: ["断料风险"], steps: ["查可用量", "算净缺口"], doneSteps: [], sourceRow: { code: "A-01" },
      bizDate: "2026-09-03", createdAt: 1, updatedAt: 1,
    }]);
    F.updateTask("t1", { status: "doing", doneSteps: ["查可用量"] });
    const t = F.listTasks({ bizDate: "2026-09-03" })[0];
    expect(t).toMatchObject({ status: "doing", title: "A料缺1700", score: 88 });
    expect(t.doneSteps).toEqual(["查可用量"]);
    expect(t.sourceRow.code).toBe("A-01");
    expect(t.steps).toHaveLength(2);
  });

  it("列表按分数倒序，且能排除已完成", () => {
    F.upsertTasks([{ id: "t2", kind: "arrival", title: "B料到货", stage: "inbound", status: "done", score: 99, bizDate: "2026-09-03", createdAt: 1, updatedAt: 1 }]);
    expect(F.listTasks({ bizDate: "2026-09-03" })[0].id).toBe("t2");
    expect(F.listTasks({ bizDate: "2026-09-03", includeClosed: false }).map((x) => x.id)).toEqual(["t1"]);
  });

  it("当日清单与学习进度可读可写", () => {
    F.setDay({ bizDate: "2026-09-03", checklist: { shortage: true } });
    expect(F.getDay("2026-09-03").checklist).toEqual({ shortage: true });
    expect(F.getDay("1999-01-01").checklist).toEqual({}); // 没有记录时给空壳而不是 undefined
    F.setProgress({ itemId: "L1", status: "done", score: 90 });
    expect(F.listProgress()[0]).toMatchObject({ itemId: "L1", status: "done", score: 90 });
  });
});

describe("盲区表（宽表通道）", () => {
  it("按 topic / status 索引查得到，JSON 字段原样往返", () => {
    tablePut("blindspots", [
      { id: "b1", topic: "ordering", status: "open", title: "拿现存量当可用量下单", kind: "wrong_metric",
        evidence: "库里有 3000 那就下 0 吧", linkedItemIds: ["B1", "B2"], occurrences: 2, firstSeenAt: 1, lastSeenAt: 9 },
      { id: "b2", topic: "supplier", status: "cleared", title: "口头「好的」当回签", kind: "misconception",
        evidence: "他说好的就是确认了", linkedItemIds: [], occurrences: 1, firstSeenAt: 2, lastSeenAt: 3 },
    ]);
    expect(tableByIndex("blindspots", "status", "open")).toHaveLength(1);
    expect(tableByIndex("blindspots", "topic", "ordering")[0].linkedItemIds).toEqual(["B1", "B2"]);
    tableUpdate("blindspots", "b1", { status: "learning", occurrences: 3 });
    expect(tableGet("blindspots", "b1")).toMatchObject({ status: "learning", occurrences: 3, title: "拿现存量当可用量下单" });
  });
});
