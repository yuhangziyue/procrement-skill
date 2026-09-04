// 工作台看板 v2：DESIGN-workbench-v2.md §3.4「三档分区 × 四泳道」的界面实现（工兵 W2）。
//
// 【老架接入注意事项】
// 1. 固定签名不改：BoardViewProps / BoardView / DEMO_TASKS。宿主（app.tsx）只管喂 props、接回调，
//    不做业务判断——`byBand` 按三档分组、`groups` 供应商合并分组这些都假定已经算好传进来
//    （对应 board/service.ts 的 loadBoard() 产出，band 判定唯一入口在 board/band.ts）。
// 2. 布局假设：本组件的根节点 `.board-view` 用 `flex:1; min-height:0` 撑满宿主给的高度，内部每条泳道各自
//    `overflow-y:auto` 滚动，整页不出横向/纵向滚动条。宿主需把 <BoardView/> 放进一个「高度已经钉死」的
//    flex/grid 容器里（参照 styles.css 里 `.layout`/`.chat` 那一套 `minmax(0,1fr)` + `min-height:0` 的写法）。
// 3. 「今天三件事」横幅与 P0~P3 四色分级已经砍掉（DESIGN §4 砍掉清单第 1/2 项）：紧急分区本身就是横幅，
//    band 决定分区与卡片语气，score 只用于档内排序，不再单独上屏。
// 4. `day.canClose` 为真时，本组件整体切换成 <DayClose/> 收工完成态，替掉三档分区+底部操作栏；
//    不是"清空页面"，仍在同一个工作台容器里。
// 5. desktopOnly / loading 两个空态优先级最高，其次是数据为空的引导态，最后才是正常看板。
// 6. 全局只有一个展开位 `expandedId`——同一张卡不管在哪个 band/泳道格子里，展开状态都一致（苏姐铁律③「一次只推一件事」）。
import { useEffect, useMemo, useState } from "preact/hooks";
import type { JSX } from "preact";
import { BANDS, STAGES, type Band, type BoardTask, type Stage } from "../board/types";
import { compareTasks } from "../board/rules";
import { BAND_ICON, BAND_TONE, TaskCard, formatBizDate } from "./TaskCard";
import { DayClose } from "./DayClose";
import { TaskEditor } from "./TaskEditor";
import { Icon, type IconName } from "./icons";
import "./BoardView.css";

export interface BoardViewProps {
  byBand: Record<Band, BoardTask[]>;
  groups: { supplier: string; taskIds: string[] }[];
  day: { items: { id: string; text: string; auto?: boolean; satisfied: boolean; detail?: string }[]; canClose: boolean; handoverText: string };
  bizDate: string;
  loading?: boolean;
  warnings?: string[];
  desktopOnly?: boolean;
  onToggleStep(taskId: string, stepId: string, done: boolean): void;
  onComplete(taskId: string, evidence: Record<string, string>): void;
  onEdit(taskId: string, patch: Partial<BoardTask["editable"]>): void;
  onAddEvent(taskId: string, ev: { channel: string; counterpart?: string; content: string; newPromiseDate?: string }): void;
  onCheck(itemId: string, checked: boolean): void;
  onCloseDay(): void;
  onRefresh(): void;
  onImport(): void;
  onAskAgent(task: BoardTask, question: string): void;
  onOpenTutorial(tutorialId: string): void;
}

/** 每档若一张卡都没有，也要显式说明——"都还挺好"不是"整段消失"。 */
const BAND_EMPTY_TEXT: Record<Band, string> = {
  urgent: "今天没有着火的事",
  follow: "今天没有要盯的动作",
  notice: "没有等你回话的事",
};

/** 泳道配图标，纯装饰、加快扫读——「现在是谁在动」这条判据文字上已经说清楚了。 */
const STAGE_ICON: Record<Stage, IconName> = { demand: "gap", to_order: "card", transit: "truck", inbound: "inbox" };

export function BoardView(props: BoardViewProps): JSX.Element {
  const { byBand, groups, day, bizDate, loading, warnings = [], desktopOnly } = props;

  const allTasks = useMemo(() => [...byBand.urgent, ...byBand.follow, ...byBand.notice], [byBand]);
  const activeTasks = useMemo(() => allTasks.filter((t) => t.status !== "dropped"), [allTasks]);
  const doneTasks = activeTasks.filter((t) => t.status === "done");
  const pendingTasks = activeTasks.filter((t) => t.status !== "done");
  const droppedCount = allTasks.length - activeTasks.length;
  const pct = activeTasks.length ? Math.round((doneTasks.length / activeTasks.length) * 100) : 0;

  // 全局只有一个展开位——换一天自动收起，默认不展开任何卡（避免和三档分区抢视觉焦点）。
  const [expandedId, setExpandedId] = useState<string | undefined>(undefined);
  useEffect(() => setExpandedId(undefined), [bizDate]);
  const toggleExpand = (id: string) => setExpandedId((cur) => (cur === id ? undefined : id));

  // 点一档只看这一档，其余分区折叠成一行；再点一次恢复全展开。
  const [focusBand, setFocusBand] = useState<Band | undefined>(undefined);
  const [dayListOpen, setDayListOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<BoardTask | undefined>(undefined);

  // 供应商合并提示：task id → 组内其它任务的标题列表。
  const peersOf = useMemo(() => {
    const map = new Map<string, string[]>();
    const byId = new Map(allTasks.map((t) => [t.id, t]));
    for (const g of groups) {
      if (g.taskIds.length < 2) continue;
      for (const id of g.taskIds) {
        const peers = g.taskIds.filter((x) => x !== id).map((x) => byId.get(x)?.title).filter(Boolean) as string[];
        if (peers.length) map.set(id, peers);
      }
    }
    return map;
  }, [allTasks, groups]);

  const cardCommon = (task: BoardTask) => (
    <TaskCard
      key={task.id}
      task={task}
      bizDate={bizDate}
      expanded={expandedId === task.id}
      groupPeers={peersOf.get(task.id)}
      onToggleExpand={() => toggleExpand(task.id)}
      onToggleStep={(stepId, done) => props.onToggleStep(task.id, stepId, done)}
      onComplete={(evidence) => props.onComplete(task.id, evidence)}
      onEdit={(patch) => props.onEdit(task.id, patch)}
      onAddEvent={(ev) => props.onAddEvent(task.id, ev)}
      onAskAgent={(q) => props.onAskAgent(task, q)}
      onOpenTutorial={props.onOpenTutorial}
      onOpenEditor={() => setEditingTask(task)}
    />
  );

  if (desktopOnly) {
    return (
      <div class="board-view board-empty-state">
        <div class="board-empty-icon"><Icon name="tutorial" size={36} /></div>
        <h3>工作看板是桌面版功能</h3>
        <p class="muted">看板要把当天任务状态存到本机数据库里，网页版没有这个存储。打开桌面版小采就能用；网页版可以先在右侧跟采姐对话。</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div class="board-view board-empty-state">
        <div class="board-empty-icon"><Icon name="clock" size={36} /></div>
        <p class="muted">看板加载中…</p>
      </div>
    );
  }

  const dayDoneCount = day.items.filter((i) => i.satisfied).length;

  return (
    <div class="board-view">
      {warnings.map((w, i) => <div key={i} class="banner warn">{w}</div>)}

      <div class="board-topline">
        <div class="board-progress" title={`${doneTasks.length}/${activeTasks.length}`}>
          <span class="board-progress-label">今日进度</span>
          <div class="board-progress-bar"><div class="board-progress-fill" style={{ width: `${pct}%` }} /></div>
          <span class="board-progress-count">{doneTasks.length}/{activeTasks.length}</span>
        </div>
        <div class="board-topline-right">
          <span class="board-topline-date">{formatBizDate(bizDate)}</span>
          <button class="btn btn-sm" onClick={props.onImport}>导数据</button>
          <button class="btn btn-sm" onClick={props.onRefresh}>刷新</button>
        </div>
      </div>

      {day.canClose ? (
        <DayClose bizDate={bizDate} handoverText={day.handoverText} doneTasks={doneTasks} pendingTasks={pendingTasks} onCloseDay={props.onCloseDay} />
      ) : activeTasks.length === 0 ? (
        <div class="board-empty-state board-empty-inline">
          <div class="board-empty-icon"><Icon name="folder" size={36} /></div>
          <h3>看板还没有数据</h3>
          <p class="muted">导一张生产表或订单执行报表，今天的卡片就能算出来——只导一张也能出卡。</p>
          <div class="board-empty-actions">
            <button class="btn btn-primary" onClick={props.onImport}>导数据</button>
            <button class="btn" onClick={props.onRefresh}>刷新今日看板</button>
          </div>
        </div>
      ) : (
        <>
          <div class="board-band-bar">
            {BANDS.map((b) => {
              const count = activeTasks.filter((t) => t.band === b.id).length;
              return (
                <button
                  key={b.id}
                  class={`band-chip band-chip-${b.id}${focusBand === b.id ? " is-focused" : ""}`}
                  onClick={() => setFocusBand((cur) => (cur === b.id ? undefined : b.id))}
                  title={b.hint}
                >
                  <Icon name={BAND_ICON[b.id]} size={14} tone={BAND_TONE[b.id]} /> {b.name} <span class="band-chip-count">{count}</span>
                </button>
              );
            })}
          </div>

          <div class="board-bands">
            {BANDS.map((band) => {
              const bandTasks = activeTasks.filter((t) => t.band === band.id);
              const collapsedByFocus = !!focusBand && focusBand !== band.id;
              return (
                <section class={`board-band board-band-${band.id}${collapsedByFocus ? " is-collapsed" : ""}`} key={band.id}>
                  <header
                    class="board-band-head"
                    role={collapsedByFocus ? "button" : undefined}
                    tabIndex={collapsedByFocus ? 0 : undefined}
                    onClick={collapsedByFocus ? () => setFocusBand(band.id) : undefined}
                  >
                    <Icon name={BAND_ICON[band.id]} size={16} tone={BAND_TONE[band.id]} />
                    <h3>{band.name}</h3>
                    <span class="board-band-hint">{band.hint}</span>
                    <span class="board-band-count">{bandTasks.length} 张</span>
                  </header>

                  {!collapsedByFocus && (
                    bandTasks.length === 0 ? (
                      <p class="board-band-empty muted">{band.name} · {BAND_EMPTY_TEXT[band.id]}</p>
                    ) : (
                      <div class="board-band-lanes">
                        {STAGES.map((stage) => {
                          const laneTasks = bandTasks.filter((t) => t.stage === stage.id).sort(compareTasks);
                          return (
                            <div class="board-band-lane" key={stage.id}>
                              <header class="board-band-lane-head">
                                <Icon name={STAGE_ICON[stage.id]} size={13} tone="muted" />
                                <span class="lane-name">{stage.name}</span>
                                <span class="lane-count">{laneTasks.length}</span>
                              </header>
                              <div class="board-band-lane-hint">{stage.hint} · <span class="lane-owner">{stage.owner}</span></div>
                              <div class="board-band-lane-body">
                                {laneTasks.length === 0 ? <p class="muted board-lane-empty">暂无</p> : laneTasks.map((t) => cardCommon(t))}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )
                  )}
                </section>
              );
            })}
          </div>

          {droppedCount > 0 && <p class="muted board-dropped-note">{droppedCount} 张卡因资料更新已自动收起（不是被删除，重新导入相关资料会恢复）。</p>}

          <div class="board-daylist">
            <button class="board-daylist-toggle" onClick={() => setDayListOpen((v) => !v)}>
              今日收工清单 {dayDoneCount}/{day.items.length}
              <Icon name={dayListOpen ? "chevronDown" : "chevronRight"} size={13} />
            </button>
            {dayListOpen && (
              <ul class="board-daylist-items">
                {day.items.map((it) => (
                  <li key={it.id}>
                    <label class={it.auto ? "is-auto" : ""}>
                      <input type="checkbox" checked={it.satisfied} disabled={!!it.auto} onChange={(e) => props.onCheck(it.id, (e.target as HTMLInputElement).checked)} />
                      <span>{it.text}</span>
                      {it.auto && <span class="daylist-auto-badge">自动判定</span>}
                    </label>
                    {it.detail && <p class="daylist-detail muted">{it.detail}</p>}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div class="board-footer">
            <button class="btn btn-primary" disabled={!day.canClose} title={day.canClose ? undefined : "还有事没关掉，全部干完才能收工"} onClick={props.onCloseDay}>收工 ▸</button>
          </div>
        </>
      )}

      {editingTask && (
        <TaskEditor
          task={editingTask}
          onSave={(patch) => { props.onEdit(editingTask.id, patch); setEditingTask(undefined); }}
          onAskAgent={(q) => props.onAskAgent(editingTask, q)}
          onClose={() => setEditingTask(undefined)}
        />
      )}
    </div>
  );
}

/** 老架冒烟用的演示数据：10 张卡，覆盖三档 × 四泳道、U8 三态（verified/unverified/unknown）与一张算不出数字的巡检卡。 */
const T0 = new Date("2026-09-04T08:00:00").getTime();
const BIZ_DATE = "2026-09-04";
const mk = (t: Partial<BoardTask> & Pick<BoardTask, "id" | "kind" | "stage" | "band" | "bandRule" | "bandWhy" | "title" | "score" | "doneRule" | "primaryAction">): BoardTask => ({
  status: "todo",
  reasons: [],
  steps: [],
  doneSteps: [],
  editable: {},
  events: [],
  bizDate: BIZ_DATE,
  createdAt: T0,
  updatedAt: T0,
  ...t,
});

export const DEMO_TASKS: BoardTask[] = [
  // ── 🔴 紧急 ──────────────────────────────────────────────
  mk({
    id: "task-u1", kind: "T1_shortage", stage: "to_order", band: "urgent", bandRule: "U2",
    bandWhy: "最晚下单日 09-04 = 今天，今天不下单就来不及",
    title: "下单「三拼腰封AL」12000",
    materialCode: "1110919", materialName: "三拼腰封AL", supplier: "示例包材",
    qty: 12000, needDate: "2026-09-08", dueDate: "2026-09-04", score: 82,
    reasons: [
      "时间压力 1.00 × 35 = 35.0　最晚动作日就是今天",
      "断料风险 0.95 × 30 = 28.5　库存+有效在途只够 0.5 天",
      "日配件 1.00 × 12 = 12.0　断一天停一条线",
      "金额 3.6 · 供应商风险 1.6 · 任务停滞 1.4",
    ],
    tutorialId: "net-requirement",
    steps: [
      { id: "s1", text: "核算式输入：可用量取的是「可用」不是「现存」？在途里逾期未决的 3000 剔了吗？", role: "gate", where: "小采工具" },
      {
        id: "s2", text: "低于 MOQ 20000，三选一——你来定，小采不替你选", role: "gate", where: "决定",
        choices: [
          { id: "c1", text: "凑到 20000", consequence: "多 8000（≈2.4 天用量），占用资金 5,600 元" },
          { id: "c2", text: "问拼单", consequence: "要等对方回，可能误 2 天" },
          { id: "c3", text: "合并下次", consequence: "下次需求 09-18，中间有 4 天缺口" },
        ],
      },
      { id: "s3", text: "按「需求日 09-08 − 生产 7 天 − 运输 2 天」倒推，最晚下单日 09-04，今天来得及", role: "hint" },
      { id: "s4", text: "一单一供应商；计划到货日填供应商承诺日，不是需求日 09-08", role: "hint", u8Path: { path: "U8 › 采购管理 › 采购订单 › 增加", confidence: "unverified" } },
      { id: "s5", text: "审核（保存 ≠ 生效）→ 导出发供应商 → 回来填订单号，自动派生「等回签」卡", role: "hint", u8Path: { path: "U8 › 采购订单 › 审核", confidence: "unverified" } },
    ],
    primaryAction: {
      id: "po_open", label: "已在 U8 开单", actionKind: "u8",
      u8Path: { path: "U8 › 采购管理 › 采购订单 › 增加", confidence: "unverified" },
      evidence: [
        { key: "poNo", label: "U8 订单号", type: "text", required: true },
        { key: "reviewed", label: "已点「审核」（保存 ≠ 生效）", type: "checkbox", required: true },
      ],
    },
    doneRule: "U8 订单号已回填 + 状态=已审核 + 已派生「等回签」卡",
    escalation: "找谁：MOQ 超出部分要不要多备，报你的领导点头。开口第一句：「张经理，三拼腰封AL 净缺口 12000，对方 MOQ 20000，多出 8000 按 2.4 天用量算，我这边想直接下 20000，你看行吗？」",
    sourceRow: { "生产需求": "13600", "现存量": "1600", "在途量": "5000（逾期未决 3000）" },
  }),
  mk({
    id: "task-u2", kind: "T2_addon", stage: "to_order", band: "urgent", bandRule: "U3",
    bandWhy: "加急单，需求日 ≤ 明天",
    title: "加急下单「纸盒A」2000", isUrgent: true,
    materialCode: "M-2031", materialName: "纸盒A", supplier: "国盛包装",
    qty: 2000, needDate: "2026-09-05", dueDate: "2026-09-04", score: 76,
    reasons: ["时间压力 1.00 × 35 = 35.0　明天就要用", "断料风险 0.6 × 30 = 18.0", "快赢 1.0 × 10 = 10.0　授权已齐，一次下单"],
    tutorialId: "po-essentials",
    steps: [{ id: "s1", text: "核对加单授权凭据（微信截图/邮件）编号是否已登记", role: "gate", where: "小采工具" }],
    primaryAction: {
      id: "po_open", label: "已在 U8 开单", actionKind: "u8",
      u8Path: { path: "U8 › 采购管理 › 采购订单 › 增加", confidence: "unverified" },
      evidence: [{ key: "poNo", label: "U8 订单号", type: "text", required: true }],
    },
    doneRule: "U8 订单号已回填 + 状态=已审核",
    escalation: "找谁：加急是否需要加价找你的领导确认。开口第一句：「王经理，纸盒A 加急单 2000 只，供应商说加价约 10% 能明天到，您看走不走加急？」",
  }),
  mk({
    id: "task-u3", kind: "T8_overdue", stage: "transit", band: "urgent", bandRule: "U10",
    bandWhy: "命中 U10：分数 182 ≥ 175（逾期 + 日配 + 已断料，基础分 ≥75）。这条本来算日常跟进，是分数把它顶上来的",
    title: "催黄工「三拼腰封」新交期", status: "doing",
    materialCode: "M-5520", materialName: "三拼腰封", supplier: "黄工包装厂", poNo: "PO24-0871",
    qty: 3000, needDate: "2026-09-02", promiseDate: "2026-09-02", dueDate: "2026-09-03", score: 182,
    reasons: [
      "断线风险 1.00 × 40 = 40.0　日配件，断一天停线",
      "时间压力 1.00 × 30 = 30.0　逾期 2 天",
      "阻塞 1.00 × 20 = 20.0　卡生产排产",
      "快赢 1.00 × 10 = 10.0　一个电话",
      "基础分 100；逾期 + 断线料 → 强制置顶 +100 ⇒ 182 → 命中 U10 升为紧急",
    ],
    doneSteps: ["s1"],
    steps: [
      { id: "s1", text: "打电话给黄工张工，问明原因 + 要新交期", role: "gate", where: "打电话" },
      { id: "s2", text: "当天通知生产：延误影响排产，瞒着只会把小事拖成事故", role: "hint", where: "通知生产" },
    ],
    editable: { blockedBy: "supplier", nextActionAt: "2026-09-04T15:00" },
    events: [{ id: "ev1", taskId: "task-u3", at: "2026-09-03 16:20", channel: "电话", counterpart: "张工", content: "对方说在赶工，明天给准信" }],
    primaryAction: {
      id: "chase_new_date", label: "已问到新交期", actionKind: "call",
      evidence: [
        { key: "newPromiseDate", label: "新交期", type: "date", required: true },
        { key: "note", label: "通话结论", type: "text", required: true },
      ],
    },
    doneRule: "拿到书面新交期，并写进跟进记录",
    escalation: "找谁：供应商推诿 → 你的领导（金额/交期让步要他点头）；要改排产 → 生产计划。开口第一句：「张工，三拼腰封 PO24-0871 计划 9 月 2 号到，现在还没到。是排产没排上还是发了在路上？我这边明早要用，麻烦给我一个准的到货日期，我记一下。」",
    sourceRow: { "计划到货日": "2026-09-02", "当前状态": "未到货", "逾期天数": "2" },
  }),

  // ── 🟡 日常跟进 ──────────────────────────────────────────
  mk({
    id: "task-f1", kind: "T10_daily_check", stage: "demand", band: "follow", bandRule: "F9",
    bandWhy: "覆盖天数 4.2 天，落在 3~7 天区间，今天跟进一次即可",
    title: "巡检日配件水位（隔板 / 贴纸两项）",
    dueDate: "2026-09-04", score: 41, coverageDays: 4.2,
    reasons: ["断线风险 0.3 × 40 = 12.0", "阻塞 0.6 × 20 = 12.0　卡仓库收货", "快赢 1.0 × 10 = 10.0　现场看一眼"],
    steps: [
      { id: "s1", text: "早上巡检一次，记录当前库存", role: "hint", where: "现场" },
      { id: "s2", text: "下午巡检一次，对比早上有没有异常消耗", role: "hint", where: "现场" },
    ],
    primaryAction: {
      id: "record_level", label: "已记完两次巡检", actionKind: "u8",
      u8Path: { path: "", confidence: "unknown", openQuestionId: "u8-stock-query", askScript: "问老采购：库存管理里「现存量」和「可用量」分别在哪张查询表？我截个图记一下。" },
      evidence: [{ key: "level", label: "今日覆盖天数", type: "text", required: true }],
    },
    doneRule: "两次巡检记录都已填（早/午）",
    escalation: "找谁：水位异常联系仓库管理员。开口第一句：「仓库这边，日配件的隔板还有多少库存，帮我看一眼数，可能要提前叫料。」",
  }),
  mk({
    id: "task-f2", kind: "T4_unconfirmed", stage: "to_order", band: "follow", bandRule: "F3",
    bandWhy: "下单后要回签——她要主动催，不是等",
    title: "要 PO24-0902 的书面回签",
    materialCode: "M-3312", materialName: "隔板", supplier: "华瑞纸业", poNo: "PO24-0902",
    qty: 2000, needDate: "2026-09-10", dueDate: "2026-09-05", score: 58,
    reasons: ["时间压力 0.85 × 35 = 29.8　回签已超时 1 个工作日", "断线风险 0.4 × 30 = 12.0", "快赢 1.0 × 10 = 10.0　一个电话"],
    steps: [{ id: "s1", text: "致电华瑞纸业张工，要书面回签交期", role: "gate", where: "打电话" }],
    editable: {}, events: [{ id: "ev2", taskId: "task-f2", at: "2026-09-03 10:05", channel: "电话", counterpart: "张工", content: "对方说明天给回签" }],
    primaryAction: {
      id: "get_signback", label: "已拿到回签", actionKind: "call",
      evidence: [
        { key: "promiseDate", label: "回签交期", type: "date", required: true },
        { key: "source", label: "回签方式", type: "select", required: true, options: ["书面回签", "口头（还需补书面）"] },
      ],
    },
    doneRule: "拿到书面回签交期并登记",
    escalation: "找谁：对方超时不回复，报你的领导让采购主管出面。开口第一句：「张工，隔板 PO24-0902 下单两天了还没见回签，麻烦今天之内给我确认一下交期，谢谢。」",
  }),
  mk({
    id: "task-f3", kind: "T5_transit", stage: "transit", band: "follow", bandRule: "F1",
    bandWhy: "在途跟踪，未到强制升级条件",
    title: "盯纸托物流节点",
    materialCode: "M-1187", materialName: "纸托", supplier: "国盛包装", poNo: "PO24-0888",
    qty: 5000, needDate: "2026-09-12", promiseDate: "2026-09-06", dueDate: "2026-09-05", score: 37,
    reasons: ["时间压力 0.5 × 35 = 17.5　承诺交期前 1 天", "断线风险 0.3 × 30 = 9.0", "快赢 1.0 × 10 = 10.0"],
    steps: [{ id: "s1", text: "在订单执行情况统计表里查发运节点", role: "gate", where: "U8" }],
    editable: { promiseDate: "2026-09-06", promiseSource: "signback" },
    primaryAction: {
      id: "check_transit", label: "已查到物流节点", actionKind: "u8",
      u8Path: { path: "U8 › 采购管理 › 订单执行情况统计表", confidence: "verified" },
      evidence: [{ key: "node", label: "当前节点", type: "text", required: true }],
    },
    tutorialId: "po-exec-stat",
    doneRule: "查到最新物流节点并登记",
    escalation: "找谁：长时间无更新联系国盛包装王姐。开口第一句：「王姐，纸托 PO24-0888 麻烦帮忙看下现在到哪了，什么时候能到？」",
  }),
  mk({
    id: "task-f4", kind: "T6_notice", stage: "inbound", band: "follow", bandRule: "F8",
    bandWhy: "固定动作，今天要发出去",
    title: "发明日到货预告（4 张单，1 急料）",
    dueDate: "2026-09-04", score: 52,
    reasons: ["时间压力 1.0 × 35 = 35.0　预告要提前一天，今天必须发", "阻塞 0.6 × 20 = 12.0　卡仓库收货", "快赢 1.0 × 10 = 10.0　一次复制粘贴"],
    steps: [
      { id: "s1", text: "从订单执行报表整理明日到货的 4 张单", role: "gate", where: "小采工具" },
      { id: "s2", text: "按六列表格式发给仓库（物料/数量/供应商/PO/预计到货/联系人）", role: "hint", where: "企业微信/邮件" },
    ],
    primaryAction: {
      id: "send_notice", label: "已发预告并拿到回执", actionKind: "message",
      evidence: [{ key: "receipt", label: "仓库回执方式", type: "select", required: true, options: ["微信确认", "邮件回复", "口头确认"] }],
    },
    doneRule: "预告六列表已发出（可复制）并拿到仓库回执",
    escalation: "找谁：仓库长期不回执，找仓库主管确认收单流程。开口第一句：「仓库您好，明天到货预告发您了，麻烦确认下收到，明天 4 张单同时到，辛苦安排卸货位，其中 1 张是急料优先卸。」",
  }),

  // ── ⚪ 提醒 ──────────────────────────────────────────────
  mk({
    id: "task-n1", kind: "T3_intercept", stage: "demand", band: "notice", bandRule: "N1",
    bandWhy: "审批流程的属于提醒——已经推给生产，等她回话",
    title: "问生产：贴纸B 标停购，还下吗？",
    materialCode: "M-6610", materialName: "贴纸B", dueDate: "2026-09-06", score: 29,
    note: "已发出 18 小时",
    reasons: ["阻塞 0.6 × 20 = 12.0　等生产回话", "时间压力 0.3 × 35 = 10.5", "快赢 1.0 × 10 = 10.0"],
    steps: [{ id: "s1", text: "系统提示该编码已标「停购」，需要生产书面确认是否继续采购", role: "hint", where: "生产确认" }],
    primaryAction: {
      id: "ask_production", label: "已拿到生产的书面结论", actionKind: "message",
      evidence: [{ key: "answer", label: "生产的结论", type: "text", required: true }],
    },
    doneRule: "拿到生产书面结论：继续下单 / 换编码 / 不下了",
    escalation: "找谁：生产计划科。开口第一句：「李工，贴纸B 在 U8 里标了停购，本月排产还要用吗？麻烦回我一句文字，我好决定下不下单。」",
  }),
  mk({
    id: "task-n2", kind: "T2_addon", stage: "demand", band: "notice", bandRule: "N2",
    bandWhy: "等授权 = 审批流程，拿不到书面就不下单",
    title: "等张主任回加单授权文字",
    materialCode: "M-7788", materialName: "插格纸板", dueDate: "2026-09-07", score: 25,
    reasons: ["阻塞 0.6 × 20 = 12.0　等授权", "时间压力 0.2 × 35 = 7.0", "快赢 1.0 × 10 = 10.0"],
    steps: [{ id: "s1", text: "口头已经同意，还差一句书面（微信文字即可）", role: "hint", where: "微信" }],
    primaryAction: {
      id: "get_auth", label: "已拿到授权文字", actionKind: "message",
      evidence: [{ key: "auth", label: "授权文字截图/摘要", type: "text", required: true }],
    },
    doneRule: "拿到书面授权文字并登记，转入待下单",
    escalation: "找谁：张主任。开口第一句：「张主任，插格纸板加单的事您口头同意了，麻烦补一句文字给我，我好走 U8 流程，谢谢。」",
  }),
  mk({
    id: "task-n3", kind: "T13_payment", stage: "inbound", band: "notice", bandRule: "N6",
    bandWhy: "已经推给财务并升级过，今天不用再推，只看一眼",
    title: "PO24-0802 该开票，月结到期 09-10",
    materialCode: "M-2077", supplier: "东辰纸品", poNo: "PO24-0802", dueDate: "2026-09-10", score: 22,
    reasons: ["时间压力 0.2 × 35 = 7.0　还剩 4 个工作日", "阻塞 0.3 × 20 = 6.0　卡财务对账", "快赢 1.0 × 10 = 10.0"],
    editable: { blockedBy: "finance", escalatedTo: "财务王姐" },
    steps: [{ id: "s1", text: "在应付款管理里确认发票登记状态", role: "hint", where: "U8" }],
    primaryAction: {
      id: "confirm_invoice", label: "已确认开票登记", actionKind: "u8",
      u8Path: { path: "U8 › 应付款管理 › 发票登记", confidence: "verified" },
      evidence: [{ key: "status", label: "登记状态", type: "text", required: true }],
    },
    tutorialId: "settle-reconcile",
    doneRule: "发票已登记且金额口径核对无误",
    escalation: "找谁：财务王姐已经在跟，逾期再升级。开口第一句：「王姐，PO24-0802 月结 09-10 到期，麻烦帮忙看下发票登记进度。」",
  }),
];
