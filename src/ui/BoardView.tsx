// 工作台看板 · 苏姐规格 spec-su.md §2/§3/§5 的界面实现（工兵 E2）。
//
// 【老架接入注意事项】
// 1. 固定签名不改：BoardViewProps / BoardView / DEMO_TASKS，见文件底部。宿主（app.tsx）只管喂 props、接回调，
//    不做业务判断——四泳道分组、置顶前 3、供应商合并分组这些都假定 `tasks` / `top3` / `groups` 已经算好传进来
//    （对应 board/service.ts 的 loadBoard() 产出）。
// 2. 布局假设：本组件的根节点 `.board-view` 用 `flex:1; min-height:0` 撑满宿主给的高度，内部四条泳道各自
//    `overflow-y:auto` 滚动，整页不出横向/纵向滚动条。这要求宿主把 <BoardView/> 放进一个「高度已经钉死」的
//    flex/grid 容器里（参照 styles.css 里 `.layout`/`.chat` 那一套 `minmax(0,1fr)` + `min-height:0` 的写法）。
//    如果宿主容器高度是 auto，泳道会退化成撑高页面，不会报错但滚动体验会跟设计不一致。
// 3. 「今天三件事」横幅与下方泳道共用同一个卡片组件 TaskCard，同一张卡在两处 id 相同、展开状态联动
//    （全局只有一个 expandedId，点开一张会收起另一张——这是苏姐铁律③「一次只推一件事」的落地）。
// 4. `day.canClose` 为真时，本组件整体切换成 <DayClose/> 收工完成态，替掉横幅+泳道+底部操作栏；
//    不是"清空页面"，仍在同一个工作台容器里。
// 5. desktopOnly / loading 两个空态优先级最高，其次是数据为空的引导态，最后才是正常看板。
import { useEffect, useMemo, useState } from "preact/hooks";
import type { JSX } from "preact";
import { STAGES, type BoardTask } from "../board/types";
import { TaskCard, formatBizDate } from "./TaskCard";
import { DayClose } from "./DayClose";
import "./BoardView.css";

export interface BoardViewProps {
  tasks: BoardTask[]; top3: BoardTask[]; groups: { supplier: string; taskIds: string[] }[];
  day: { items: { id: string; text: string; auto?: boolean; satisfied: boolean; detail?: string }[]; canClose: boolean; handoverText: string };
  bizDate: string; loading?: boolean; warnings?: string[]; desktopOnly?: boolean;
  onToggleStep(taskId: string, stepId: string, done: boolean): void;
  onStatus(taskId: string, status: BoardTask["status"], note?: string): void;
  onCheck(itemId: string, checked: boolean): void;
  onCloseDay(): void;
  onRefresh(): void;                                    // 「刷新今日看板」——从资料库重算
  onAskAgent(task: BoardTask, question: string): void;  // 「问采姐」
  onImport(): void;                                     // 「导数据」
}

export function BoardView(props: BoardViewProps): JSX.Element {
  const { tasks, top3, groups, day, bizDate, loading, warnings = [], desktopOnly } = props;

  // 全局只有一个展开位——同一张卡不管出现在横幅还是泳道，展开状态都一致；换一天自动收起、默认展开 Top1。
  const [expandedId, setExpandedId] = useState<string | undefined>(top3[0]?.id);
  useEffect(() => setExpandedId(top3[0]?.id), [bizDate]);
  const toggleExpand = (id: string) => setExpandedId((cur) => (cur === id ? undefined : id));

  // 供应商合并提示：task id → 组内其它任务的标题列表（苏姐铁律②的一部分，R2 合并）。
  const peersOf = useMemo(() => {
    const map = new Map<string, string[]>();
    const byId = new Map(tasks.map((t) => [t.id, t]));
    for (const g of groups) {
      if (g.taskIds.length < 2) continue;
      for (const id of g.taskIds) {
        const peers = g.taskIds.filter((x) => x !== id).map((x) => byId.get(x)?.title).filter(Boolean) as string[];
        if (peers.length) map.set(id, peers);
      }
    }
    return map;
  }, [tasks, groups]);

  const activeTasks = tasks.filter((t) => t.status !== "dropped");
  const doneTasks = activeTasks.filter((t) => t.status === "done");
  const pendingTasks = activeTasks.filter((t) => t.status !== "done");
  const droppedCount = tasks.length - activeTasks.length;
  const pct = activeTasks.length ? Math.round((doneTasks.length / activeTasks.length) * 100) : 0;

  const cardCommon = (task: BoardTask, variant: "top3" | "lane") => (
    <TaskCard
      key={task.id}
      task={task}
      bizDate={bizDate}
      variant={variant}
      expanded={expandedId === task.id}
      groupPeers={peersOf.get(task.id)}
      onToggleExpand={() => toggleExpand(task.id)}
      onToggleStep={(stepId, done) => props.onToggleStep(task.id, stepId, done)}
      onStatus={(status, note) => props.onStatus(task.id, status, note)}
      onAskAgent={(q) => props.onAskAgent(task, q)}
    />
  );

  if (desktopOnly) {
    return (
      <div class="board-view board-empty-state">
        <div class="board-empty-icon">🖥</div>
        <h3>工作看板是桌面版功能</h3>
        <p class="muted">看板要把当天任务状态存到本机数据库里，网页版没有这个存储。打开桌面版小采就能用；网页版可以先在右侧跟采姐对话。</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div class="board-view board-empty-state">
        <div class="board-empty-icon">⏳</div>
        <p class="muted">看板加载中…</p>
      </div>
    );
  }

  return (
    <div class="board-view">
      {warnings.map((w, i) => <div key={i} class="banner warn">{w}</div>)}

      <div class="board-topline">
        <div class="board-progress" title={`${doneTasks.length}/${activeTasks.length}`}>
          <span class="board-progress-label">今日进度</span>
          <div class="board-progress-bar"><div class="board-progress-fill" style={{ width: `${pct}%` }} /></div>
          <span class="board-progress-count">{doneTasks.length}/{activeTasks.length}</span>
        </div>
        <div class="board-topline-date">{formatBizDate(bizDate)}</div>
      </div>

      {day.canClose ? (
        <DayClose bizDate={bizDate} handoverText={day.handoverText} doneTasks={doneTasks} pendingTasks={pendingTasks} onCloseDay={props.onCloseDay} />
      ) : activeTasks.length === 0 ? (
        <div class="board-empty-state board-empty-inline">
          <div class="board-empty-icon">🗂</div>
          <h3>看板还没有数据</h3>
          <p class="muted">导一张生产表或订单执行报表，今天的卡片就能算出来——只导一张也能出卡。</p>
          <div class="board-empty-actions">
            <button class="btn btn-primary" onClick={props.onImport}>导数据</button>
            <button class="btn" onClick={props.onRefresh}>刷新今日看板</button>
          </div>
        </div>
      ) : (
        <>
          <section class="board-top3">
            <h3 class="board-top3-title">▌今天三件事</h3>
            {top3.length === 0 ? (
              <p class="board-top3-empty muted">今天没有着火的事，按泳道往下走就行</p>
            ) : (
              <div class="board-top3-list">{top3.map((t) => cardCommon(t, "top3"))}</div>
            )}
          </section>

          <div class="board-lanes">
            {STAGES.map((stage) => {
              const laneTasks = activeTasks
                .filter((t) => t.stage === stage.id)
                .sort((a, b) => b.score - a.score || (a.needDate ?? "").localeCompare(b.needDate ?? "") || (a.materialCode ?? "").localeCompare(b.materialCode ?? ""));
              const todo = laneTasks.filter((t) => t.status !== "done").length;
              return (
                <section class="board-lane" key={stage.id}>
                  <header class="board-lane-head">
                    <div class="board-lane-title">{stage.name} <span class="board-lane-count">{todo}</span></div>
                    <div class="board-lane-hint">{stage.hint}</div>
                  </header>
                  <div class="board-lane-body">
                    {laneTasks.length === 0
                      ? <p class="muted board-lane-empty">暂无</p>
                      : laneTasks.map((t) => cardCommon(t, "lane"))}
                  </div>
                </section>
              );
            })}
          </div>

          {droppedCount > 0 && <p class="muted board-dropped-note">{droppedCount} 张卡因资料更新已自动收起（不是被删除，重新导入相关资料会恢复）。</p>}

          <div class="board-footer">
            <div class="board-footer-actions">
              <button class="btn" onClick={props.onImport}>导数据</button>
              <button class="btn" onClick={props.onRefresh}>刷新今日看板</button>
            </div>
            <button class="btn btn-primary" disabled={!day.canClose} title={day.canClose ? undefined : "还有事没关掉，全部干完才能收工"} onClick={props.onCloseDay}>收工 ▸</button>
          </div>
        </>
      )}
    </div>
  );
}

/** 老架冒烟用的演示数据：8 张卡，覆盖四泳道 + 一张强制置顶的逾期断线卡 + 一张算不出数字的巡检卡。 */
const T0 = new Date("2026-09-04T08:00:00").getTime();
const BIZ_DATE = "2026-09-04";
const mk = (t: Partial<BoardTask> & Pick<BoardTask, "id" | "kind" | "stage" | "title" | "score" | "doneRule">): BoardTask => ({
  status: "todo",
  reasons: [],
  steps: [],
  doneSteps: [],
  bizDate: BIZ_DATE,
  createdAt: T0,
  updatedAt: T0,
  ...t,
});

export const DEMO_TASKS: BoardTask[] = [
  mk({
    id: "task-order-1", kind: "T1_shortage", stage: "order",
    title: "下单：纸盒A（净缺口 1700）",
    materialCode: "M-2031", materialName: "纸盒A", supplier: "国盛包装",
    qty: 1700, needDate: "2026-09-08", dueDate: "2026-09-05", score: 78,
    reasons: [
      "断线 0.7（本周排产要用）× 40 = 28",
      "时限 0.85（最晚下单日 09-05，还剩 1 个工作日）× 30 = 25.5",
      "阻塞 0.6（卡仓库收货）× 20 = 12",
      "快赢 0.5（一次电话确认 MOQ）× 10 = 5",
    ],
    steps: [
      { id: "s1", text: "跟国盛包装确认 MOQ 2000 的三选一方案", where: "打电话" },
      { id: "s2", text: "在 U8 建采购订单并提交审核", where: "U8 采购订单" },
      { id: "s3", text: "拿到供应商回签后登进跟进记录", where: "跟进表" },
    ],
    doneRule: "U8 里订单已审核 + 供应商回签",
    escalation: "找谁：MOQ 超出部分要不要多备，报你的领导点头。开口第一句：「张经理，纸盒A净缺口1700，对方MOQ 2000，多出300只按15天用量算不浪费，我这边想直接下2000，你看行吗？」",
    sourceRow: { "生产需求": "3700", "现存量": "2000", "在途量": "0" },
  }),
  mk({
    id: "task-order-2", kind: "T10_daily_check", stage: "order",
    title: "巡检日配件水位（隔板 / 贴纸两项）",
    dueDate: "2026-09-04", score: 19,
    reasons: ["断线 0.15（安全库存补货）× 40 = 6", "阻塞 0.6（卡仓库收货）× 20 = 12", "快赢 1.0（现场看一眼）× 10 = 10"],
    steps: [
      { id: "s1", text: "早上巡检一次，记录当前库存", where: "现场" },
      { id: "s2", text: "下午巡检一次，对比早上有没有异常消耗", where: "现场" },
    ],
    doneRule: "两次巡检记录都已填（早/午）",
    escalation: "找谁：水位异常联系仓库管理员。开口第一句：「仓库这边，日配件的隔板还有多少库存，帮我看一眼数，可能要提前叫料。」",
  }),
  mk({
    id: "task-confirm-1", kind: "T4_unconfirmed", stage: "confirm",
    title: "催隔板供应商回签交期",
    materialCode: "M-3312", materialName: "隔板", supplier: "华瑞纸业", poNo: "PO24-0902",
    qty: 2000, needDate: "2026-09-10", dueDate: "2026-09-04", score: 55,
    reasons: ["时限 0.85（回签已超时 1 个工作日）× 30 = 25.5", "断线 0.4（下周排产要用）× 40 = 16", "快赢 1.0（一个电话）× 10 = 10"],
    steps: [
      { id: "s1", text: "致电华瑞纸业张工，要书面回签交期", where: "打电话" },
      { id: "s2", text: "交期写进跟进记录", where: "跟进表" },
      { id: "s3", text: "超过 2 个工作日未回签，上报你的领导", where: "升级" },
    ],
    doneRule: "拿到书面回签交期并登记",
    escalation: "找谁：对方超时不回复，报你的领导让采购主管出面。开口第一句：「张工，隔板 PO24-0902 下单两天了还没见回签，麻烦今天之内给我确认一下交期，谢谢。」",
    sourceRow: { "下单日": "2026-09-03", "回签状态": "未回签" },
  }),
  mk({
    id: "task-confirm-2", kind: "T4_unconfirmed", stage: "confirm",
    title: "跟进纸托订单回签",
    materialCode: "M-1187", materialName: "纸托", supplier: "国盛包装", poNo: "PO24-0888",
    qty: 5000, needDate: "2026-09-12", dueDate: "2026-09-05", score: 28,
    reasons: ["时限 0.5（还剩 3 个工作日）× 30 = 15", "断线 0.15（安全库存补货）× 40 = 6", "快赢 1.0（一个电话）× 10 = 10"],
    steps: [
      { id: "s1", text: "致电国盛包装确认回签进度", where: "打电话" },
      { id: "s2", text: "交期写进跟进记录", where: "跟进表" },
    ],
    doneRule: "拿到回签交期并登记",
    escalation: "找谁：无异常，正常跟进即可。开口第一句：「王姐，纸托 PO24-0888 麻烦帮忙确认下回签，什么时候能给我？」",
  }),
  mk({
    id: "task-transit-1", kind: "T8_overdue", stage: "transit",
    title: "催黄工「三拼腰封」新交期",
    materialCode: "M-5520", materialName: "三拼腰封", supplier: "黄工包装厂", poNo: "PO24-0871",
    qty: 3000, needDate: "2026-09-02", promiseDate: "2026-09-02", dueDate: "2026-09-03", score: 200, status: "doing",
    reasons: [
      "断线 1.0（日配件，断一天停线）× 40 = 40",
      "时限 1.0（逾期 2 天）× 30 = 30",
      "阻塞 1.0（卡生产排产）× 20 = 20",
      "快赢 1.0（一个电话）× 10 = 10",
      "基础分 100；逾期 + 断线料 → 强制置顶 +100 ⇒ 200",
    ],
    steps: [
      { id: "s1", text: "打电话给黄工张工（138****2210），问明原因 + 要新交期", where: "打电话" },
      { id: "s2", text: "新交期写进跟进记录：「9/4 电话张工：__________」", where: "跟进表" },
      { id: "s3", text: "当天通知生产：延误影响排产，瞒着只会把小事拖成事故", where: "通知生产" },
    ],
    doneSteps: ["s1"],
    doneRule: "拿到书面新交期，并写进跟进记录",
    escalation: "找谁：供应商推诿 → 你的领导（金额/交期让步要他点头）；要改排产 → 生产计划。开口第一句：「张工，三拼腰封 PO24-0871 计划 9 月 2 号到，现在还没到。是排产没排上还是发了在路上？我这边明早要用，麻烦给我一个准的到货日期，我记一下。」",
    sourceRow: { "计划到货日": "2026-09-02", "当前状态": "未到货", "逾期天数": "2" },
  }),
  mk({
    id: "task-transit-2", kind: "T5_transit", stage: "transit",
    title: "跟进插格纸板发运",
    materialCode: "M-4410", materialName: "插格纸板", supplier: "华瑞纸业", poNo: "PO24-0910",
    qty: 1200, needDate: "2026-09-07", promiseDate: "2026-09-06", dueDate: "2026-09-05", score: 44,
    reasons: ["时限 0.5（承诺交期前 1 天，还剩 1 个工作日）× 30 = 15", "断线 0.4（下周排产要用）× 40 = 16", "快赢 0.5（一次跟单电话）× 10 = 5"],
    steps: [
      { id: "s1", text: "致电华瑞纸业确认是否已发运", where: "打电话" },
      { id: "s2", text: "拿到物流单号并登记", where: "跟进表" },
    ],
    doneRule: "确认已发运并拿到物流单号",
    escalation: "找谁：物流延误联系供应商发运负责人。开口第一句：「李工，插格纸板 PO24-0910 明天要到货了，麻烦确认下今天有没有发出，给我个物流单号。」",
  }),
  mk({
    id: "task-inbound-1", kind: "T6_notice", stage: "inbound",
    title: "给仓库发明日到货预告（4 张单）",
    dueDate: "2026-09-04", score: 61,
    reasons: ["时限 1.0（到货预告要提前一天，今天必须发）× 30 = 30", "阻塞 0.6（卡仓库收货）× 20 = 12", "断线 0.4（下周排产要用）× 40 = 16", "快赢 1.0（一次复制粘贴）× 10 = 10"],
    steps: [
      { id: "s1", text: "从订单执行报表整理明日到货的 4 张单", where: "小采工具" },
      { id: "s2", text: "按六列表格式发给仓库（物料/数量/供应商/PO/预计到货/联系人）", where: "企业微信/邮件" },
      { id: "s3", text: "拿到仓库回执确认收到", where: "跟进" },
    ],
    doneRule: "预告六列表已发出（可复制）并拿到仓库回执",
    escalation: "找谁：仓库长期不回执，找仓库主管确认收单流程。开口第一句：「仓库您好，明天到货预告发您了，麻烦确认下收到，明天几张单同时到，辛苦安排卸货位。」",
  }),
  mk({
    id: "task-inbound-2", kind: "T9_discrepancy", stage: "inbound",
    title: "核对纸盒B到货数量差异",
    materialCode: "M-2077", materialName: "纸盒B", supplier: "东辰纸品", poNo: "PO24-0855",
    qty: 150, dueDate: "2026-09-04", score: 25,
    reasons: ["阻塞 0.3（卡财务对账）× 20 = 6", "时限 1.0（到货当日必须核对）× 30 = 30", "快赢 1.0（清点+登记）× 10 = 10"],
    steps: [
      { id: "s1", text: "现场清点实收数量，与送货单核对", where: "现场" },
      { id: "s2", text: "差异登记，同步告知品质与仓库", where: "跟进表" },
    ],
    doneRule: "差异已登记并告知品质/仓库",
    escalation: "找谁：差异较大找品质确认是否让步接收。开口第一句：「品质那边，纸盒B今天到货少了150只，麻烦看下是不是先按实收入库，差的部分我跟供应商补。」",
    sourceRow: { "应到数量": "2000", "实收数量": "1850", "差异": "150" },
  }),
];
