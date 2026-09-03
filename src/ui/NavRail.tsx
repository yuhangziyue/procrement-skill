import "./NavRail.css";
// 一级导航。苏姐定的 4+1：工作台 / 知识库 / U8 教程 / 学习计划 + 设置，对话是常驻侧栏不占导航位。
export type ViewId = "board" | "knowledge" | "tutorial" | "learning";

const ITEMS: { id: ViewId; icon: string; name: string; hint: string }[] = [
  { id: "board", icon: "🗂", name: "工作台", hint: "今天要干的事，按优先级排好" },
  { id: "knowledge", icon: "📚", name: "知识库", hint: "把公司文档喂进来，问答时自动引用" },
  { id: "tutorial", icon: "🖥", name: "U8 教程", hint: "查询 / 导入 / 导出 分步图文" },
  { id: "learning", icon: "🎓", name: "学习计划", hint: "16 周补齐盲区" },
];

export function NavRail({ view, onChange, onSettings, alert }: {
  view: ViewId; onChange: (v: ViewId) => void; onSettings: () => void; alert?: boolean;
}) {
  return (
    <nav class="rail">
      <div class="rail-brand" title="小采 · 采购工作台">小采</div>
      <div class="rail-items">
        {ITEMS.map((it) => (
          <button key={it.id} class={`rail-item${view === it.id ? " on" : ""}`} onClick={() => onChange(it.id)} title={it.hint}>
            <span class="rail-icon">{it.icon}</span>
            <span class="rail-name">{it.name}</span>
          </button>
        ))}
      </div>
      <button class="rail-item rail-settings" onClick={onSettings} title="模型、代理、公司五问">
        <span class="rail-icon">⚙</span><span class="rail-name">设置</span>
        {alert && <span class="dot" />}
      </button>
    </nav>
  );
}
