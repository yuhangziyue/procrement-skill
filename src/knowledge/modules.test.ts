import { describe, expect, it } from "vitest";
import { buildGraph, type GraphChunk, type GraphDoc } from "./graph";
import { MODULES, moduleOf, moduleProgress } from "./modules";
import { TOPICS } from "./taxonomy";

describe("MODULES：六个模块的静态结构", () => {
  it("恰好六个模块", () => {
    expect(MODULES).toHaveLength(6);
  });

  it("模块 id 互不重复", () => {
    const ids = MODULES.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("不设「系统操作 / U8」模块——没有一个模块 id 或 name 叫这个", () => {
    for (const m of MODULES) {
      expect(m.id).not.toMatch(/^u8$/i);
      expect(m.name).not.toMatch(/系统操作|^u8/i);
    }
  });

  it("40 条主题全部归入某个模块，一条不漏", () => {
    const covered = new Set(MODULES.flatMap((m) => m.topicIds));
    for (const t of TOPICS) {
      expect(covered.has(t.id)).toBe(true);
    }
    expect(covered.size).toBe(TOPICS.length);
  });

  it("同一条主题只属于一个模块，不重复归属", () => {
    const seen = new Map<string, string>();
    for (const m of MODULES) {
      for (const topicId of m.topicIds) {
        expect(seen.has(topicId), `主题「${topicId}」同时挂在「${seen.get(topicId)}」和「${m.id}」下`).toBe(false);
        seen.set(topicId, m.id);
      }
    }
  });

  it("模块内 topicIds 引用的都是 taxonomy 里真实存在的主题", () => {
    const validIds = new Set(TOPICS.map((t) => t.id));
    for (const m of MODULES) {
      for (const topicId of m.topicIds) {
        expect(validIds.has(topicId)).toBe(true);
      }
    }
  });

  it("前四个模块 id 与看板泳道枚举一致（demand/to_order/transit/inbound）", () => {
    const laneIds = ["demand", "to_order", "transit", "inbound"];
    const stagedModules = MODULES.filter((m) => m.stage !== undefined);
    expect(stagedModules.map((m) => m.id).sort()).toEqual([...laneIds].sort());
    for (const m of stagedModules) {
      // 与泳道同名同色的口径：模块 id 本身就是它对齐的那条泳道
      expect(m.stage).toBe(m.id);
    }
  });

  it("后两个模块（钱与票 / 规矩与底线）不设 stage，落中性色", () => {
    const rest = MODULES.filter((m) => m.stage === undefined);
    expect(rest.map((m) => m.id).sort()).toEqual(["money", "rules"]);
  });

  it("每个模块的 blurb 都不为空——首屏卡片靠它说清「什么时候来」", () => {
    for (const m of MODULES) {
      expect(m.blurb.trim().length).toBeGreaterThan(0);
    }
  });
});

describe("moduleOf", () => {
  it("40 条主题每一条都能找到自己的模块", () => {
    for (const t of TOPICS) {
      expect(moduleOf(t.id)).toBeDefined();
    }
  });

  it("挂号具体主题得到正确的模块", () => {
    expect(moduleOf("ordering.available-qty")?.id).toBe("demand");
    expect(moduleOf("u8.po-entry")?.id).toBe("to_order");
    expect(moduleOf("collab.chase-script")?.id).toBe("transit");
    expect(moduleOf("inbound.acceptance")?.id).toBe("inbound");
    expect(moduleOf("finance.tax-inclusive")?.id).toBe("money");
    expect(moduleOf("policy.integrity")?.id).toBe("rules");
  });

  it("不存在的主题 id 返回 undefined", () => {
    expect(moduleOf("nope.not-a-topic")).toBeUndefined();
  });

  it("u8.* 四条按业务动作拆进了对应模块，没有一条落进一个独立的『系统操作』桶", () => {
    // 四条 u8 主题应该分散在至少两个不同模块里，而不是全挤在一起自成一派
    const u8Modules = new Set(TOPICS.filter((t) => t.category === "u8").map((t) => moduleOf(t.id)?.id));
    expect(u8Modules.size).toBeGreaterThan(1);
  });
});

describe("moduleProgress", () => {
  const emptyGraph = buildGraph([], []);

  it("空知识库：done = 0，total = 模块主题数", () => {
    const p = moduleProgress("demand", emptyGraph.coverage);
    expect(p.done).toBe(0);
    expect(p.total).toBe(MODULES.find((m) => m.id === "demand")!.topicIds.length);
  });

  it("空知识库下，required 主题必然缺失，worstGap 一定存在", () => {
    const p = moduleProgress("demand", emptyGraph.coverage);
    expect(p.worstGap).toBeDefined();
    expect(p.worstGap!.name.length).toBeGreaterThan(0);
    expect(p.worstGap!.why.length).toBeGreaterThan(0);
  });

  it("不存在的模块 id 返回 done=0 total=0，不抛错", () => {
    const p = moduleProgress("does-not-exist", emptyGraph.coverage);
    expect(p).toEqual({ done: 0, total: 0 });
  });

  it("worstGap 取的是「required 且未覆盖」里、按 taxonomy 声明顺序排第一条的那条——不是任意一条", () => {
    // demand 模块的 required 主题在 taxonomy SEEDS 里的声明顺序：
    // u8.stock-query（系统操作段）先于 ordering.* / material.*（下单与算量段、物料段）。
    // 全部未覆盖时，worstGap 必须是 SEEDS 里最早声明的那条，而不是模块 topicIds 数组里排第一的那条。
    const order = TOPICS.map((t) => t.id);
    const mod = MODULES.find((m) => m.id === "demand")!;
    const requiredInOrder = order.filter((id) => mod.topicIds.includes(id) && TOPICS.find((t) => t.id === id)!.required);
    const firstRequiredTopic = TOPICS.find((t) => t.id === requiredInOrder[0])!;

    const p = moduleProgress("demand", emptyGraph.coverage);
    expect(p.worstGap!.name).toBe(firstRequiredTopic.name);
    expect(firstRequiredTopic.id).toBe("u8.stock-query"); // 锁死具体是哪一条，防止断言本身漂移
  });

  it("覆盖了模块内唯一的 required 缺口后，worstGap 变为 undefined 或指向下一条", () => {
    // 构造一批切片，把 demand 模块的全部 required 主题都喂满
    const requiredInDemand = TOPICS.filter(
      (t) => t.required && MODULES.find((m) => m.id === "demand")!.topicIds.includes(t.id),
    );
    const docs: GraphDoc[] = [{ id: "d1", title: "测试文档" }];
    const chunks: GraphChunk[] = requiredInDemand.flatMap((t, i) => {
      const need = t.satisfiedBy.minChunks ?? 1;
      return Array.from({ length: need }, (_, k) => ({
        id: `c-${i}-${k}`,
        docId: "d1",
        heading: "",
        text: t.satisfiedBy.keywords.join(" "),
      }));
    });
    const graph = buildGraph(docs, chunks);
    const p = moduleProgress("demand", graph.coverage);
    expect(p.worstGap).toBeUndefined();
    // material.substitute 是 demand 模块里唯一的非必备主题，没喂它关键词，所以 done 少这一条
    expect(p.done).toBe(p.total - 1);
  });

  it("done 只统计 satisfied（命中数达标），弱命中不算数", () => {
    // supplier.performance 属于 transit 模块，非必备；只给一个关键词命中一次，不到 minChunks 就不算 satisfied
    const topic = TOPICS.find((t) => t.id === "supplier.performance")!;
    const need = topic.satisfiedBy.minChunks ?? 1;
    if (need > 1) {
      const docs: GraphDoc[] = [{ id: "d1", title: "测试文档" }];
      const chunks: GraphChunk[] = [{ id: "c1", docId: "d1", heading: "", text: topic.satisfiedBy.keywords[0] }];
      const graph = buildGraph(docs, chunks);
      const p = moduleProgress("transit", graph.coverage);
      expect(p.done).toBe(0);
    } else {
      expect(true).toBe(true); // minChunks 恰好是 1，这条断言在当前数据下不适用，占位保持用例结构
    }
  });
});
