import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_FILE_BYTES, csvToText, decodeText, extOf, extractText, ingestFile, rowsToText, summarize, titleOf } from "./ingest";

// 桌面桥假体：ingest 只通过 window.xiaocai.call 落库，测试里换成 spy 就能全链路跑（不碰 SQLite）
const calls: { name: string; args: unknown[] }[] = [];
function fakeDesktop() {
  calls.length = 0;
  (globalThis as any).window = {
    xiaocai: {
      isDesktop: true,
      platform: "darwin",
      call: vi.fn(async (name: string, ...args: unknown[]) => {
        calls.push({ name, args });
        return undefined;
      }),
    },
  };
}
const noDesktop = () => delete (globalThis as any).window;
const callOf = (name: string) => calls.find((c) => c.name === name);

beforeEach(fakeDesktop);
afterEach(noDesktop);

describe("小工具", () => {
  it("extOf 取小写扩展名", () => {
    expect(extOf("采购制度 V2.DOCX")).toBe("docx");
    expect(extOf("没有扩展名")).toBe("");
  });

  it("decodeText：UTF-8 正常，GBK 回退", () => {
    const utf8 = new TextEncoder().encode("采购制度").buffer;
    expect(decodeText(utf8)).toEqual({ text: "采购制度", fallback: false });
    // GBK 里「采购」= B2 C9 B9 BA，按 UTF-8 严格解码必失败
    const gbk = new Uint8Array([0xb2, 0xc9, 0xb9, 0xba]).buffer;
    const r = decodeText(gbk);
    expect(r.fallback).toBe(true);
    expect(r.text).toBe("采购");
  });

  it("rowsToText 输出「列名: 值」，跳过空单元格", () => {
    expect(rowsToText([{ 物料编码: "1100001", 名称: "腰封", 备注: "" }])).toBe("物料编码: 1100001 | 名称: 腰封");
  });

  it("csvToText 去 BOM、一行一段", () => {
    const text = csvToText("﻿存货编码,存货名称\n1100001,腰封\n1100002,纸盒\n");
    expect(text).toBe("存货编码: 1100001 | 存货名称: 腰封\n\n存货编码: 1100002 | 存货名称: 纸盒");
  });

  it("titleOf 优先取文档里的一级标题", () => {
    expect(titleOf("abc.md", "# 采购管理制度\n正文")).toBe("采购管理制度");
    expect(titleOf("采购管理制度.md", "没有标题的正文")).toBe("采购管理制度");
  });

  it("summarize 拼前几块首句，控制在 80 字内", () => {
    const s = summarize([{ text: "# 标题\n采购要先看缺料表。后面还有很多话。" }, { text: "然后按 MOQ 凑整。" }]);
    expect(s.startsWith("标题采购要先看缺料表。")).toBe(true);
    expect(s.length).toBeLessThanOrEqual(80);
    expect(summarize([{ text: "很短。" }, { text: "也短。" }]).length).toBeGreaterThan(0);
    expect(summarize([{ text: "长".repeat(300) }]).endsWith("…")).toBe(true);
  });
});

describe("extractText", () => {
  it("md 原样返回文本，无警告", async () => {
    const f = new File(["# 采购制度\n请购单要先审批。"], "制度.md", { type: "text/markdown" });
    expect(await extractText(f)).toEqual({ text: "# 采购制度\n请购单要先审批。", warnings: [] });
  });

  it("csv 转成可读文本行", async () => {
    const f = new File(["供应商,账期\n甲厂,月结60\n"], "供应商.csv");
    const r = await extractText(f);
    expect(r.text).toBe("供应商: 甲厂 | 账期: 月结60");
  });

  it("GBK 文本给出编码提示", async () => {
    const f = new File([new Uint8Array([0xb2, 0xc9, 0xb9, 0xba])], "gbk.txt");
    const r = await extractText(f);
    expect(r.text).toBe("采购");
    expect(r.warnings[0]).toContain("GB18030");
  });
});

describe("ingestFile 正常路径", () => {
  it("md：切块、归类、写 documents + chunks", async () => {
    const md = [
      "# U8 下单操作",
      "## 生成采购订单",
      "在 U8 里从业务工作进去，参照请购单生单，检查表体数量以后审核单据。".repeat(6),
      "## 到货入库",
      "到货预告发出来以后，仓库点数签收，质检报检合格才能做入库单。".repeat(6),
    ].join("\n\n");
    const r = await ingestFile(new File([md], "U8下单.md", { type: "text/markdown" }));

    expect(r.title).toBe("U8 下单操作");
    expect(r.chunks).toBeGreaterThanOrEqual(2);
    expect(r.charCount).toBe(md.length);
    expect(r.warnings).toEqual([]);

    const doc = callOf("kb.upsertDoc")!.args[0] as any;
    expect(doc.id).toBe(r.docId);
    expect(doc.sourceName).toBe("U8下单.md");
    expect(doc.chunkCount).toBe(r.chunks);
    expect(doc.summary.length).toBeGreaterThan(0);
    // 一半 U8 一半入库：文档主分类是其中之一，另一个落到 tags
    expect([...(doc.tags as string[]), doc.category].sort()).toEqual(["inbound", "u8"]);

    const [docId, chunks] = callOf("kb.insertChunks")!.args as [string, any[]];
    expect(docId).toBe(r.docId);
    expect(chunks).toHaveLength(r.chunks);
    expect(chunks.map((c) => c.seq)).toEqual(chunks.map((_, i) => i));
    expect(chunks[0].heading).toBe("U8 下单操作 > 生成采购订单");
    expect(chunks.every((c) => c.id && c.text)).toBe(true);
  });

  it("csv：按行入库，分类落在表格内容上", async () => {
    const rows = Array.from({ length: 12 }, (_, i) => `PO-${i},甲厂,已到货待质检报检`).join("\n");
    const r = await ingestFile(new File([`订单号,供应商,到货状态\n${rows}\n`], "到货跟踪.csv"));
    expect(r.title).toBe("到货跟踪");
    expect(r.chunks).toBeGreaterThanOrEqual(1);
    expect(callOf("kb.insertChunks")).toBeTruthy();
    expect((callOf("kb.upsertDoc")!.args[0] as any).category).toBe("inbound");
  });
});

describe("ingestFile 的中文报错", () => {
  it("网页版：明说是桌面版功能", async () => {
    noDesktop();
    await expect(ingestFile(new File(["x"], "a.md"))).rejects.toThrow(/桌面版/);
  });

  it("不支持的格式", async () => {
    await expect(ingestFile(new File(["x"], "报告.pptx"))).rejects.toThrow(/还读不了/);
    expect(calls).toHaveLength(0);
  });

  it("空文件", async () => {
    await expect(ingestFile(new File([], "空的.md"))).rejects.toThrow(/空文件/);
  });

  it("超过 5MB", async () => {
    const big = new File([new Uint8Array(MAX_FILE_BYTES + 1)], "大文件.txt");
    await expect(ingestFile(big)).rejects.toThrow(/超过 5 MB 上限/);
  });

  it("只有空白 → 说没读到文字", async () => {
    await expect(ingestFile(new File(["   \n\n\t "], "白纸.txt"))).rejects.toThrow(/没读到任何文字/);
    expect(calls).toHaveLength(0);
  });
});
