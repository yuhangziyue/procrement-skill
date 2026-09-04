import "./NavRail.css";
import { BrandMark, Icon, type IconName } from "./icons";
// 一级导航。苏姐定的 4+1：工作台 / 知识库 / U8 教程 / 学习计划 + 设置，对话是常驻侧栏不占导航位。
export type ViewId = "board" | "knowledge" | "tutorial" | "learning";

const ITEMS: { id: ViewId; icon: IconName; name: string; hint: string }[] = [
  { id: "board", icon: "board", name: "工作台", hint: "今天要干的事，按优先级排好" },
  { id: "knowledge", icon: "knowledge", name: "知识库", hint: "把公司文档喂进来，问答时自动引用" },
  { id: "tutorial", icon: "tutorial", name: "U8 教程", hint: "查询 / 导入 / 导出 分步图文" },
  { id: "learning", icon: "learning", name: "学习计划", hint: "16 周补齐盲区" },
];

export function NavRail({ view, onChange, onSettings, alert }: {
  view: ViewId; onChange: (v: ViewId) => void; onSettings: () => void; alert?: boolean;
}) {
  return (
    <nav class="rail">
      {/* 标题栏安全区：桌面版 hiddenInset 的红绿灯按钮会压在这块区域，留白给它走，不放任何内容 */}
      <div class="rail-dragzone" />
      <div class="rail-brand" title="小采 · 采购工作台">
        <BrandMark size={26} />
        <div class="rail-brand-text">
          <span class="rail-brand-name">小采</span>
          <span class="rail-brand-sub">采购工作台</span>
        </div>
      </div>
      <div class="rail-items">
        {ITEMS.map((it) => (
          <button
            key={it.id}
            class={`rail-item${view === it.id ? " on" : ""}`}
            onClick={() => onChange(it.id)}
            title={it.hint}
            aria-label={it.name}
            aria-current={view === it.id ? "page" : undefined}
          >
            <Icon name={it.icon} size={19} />
            <span class="rail-name">{it.name}</span>
          </button>
        ))}
      </div>
      <button class="rail-item rail-settings" onClick={onSettings} title="模型、代理、公司五问" aria-label="设置">
        <Icon name="settings" size={19} />
        <span class="rail-name">设置</span>
        {alert && <span class="dot" aria-hidden="true" />}
      </button>
    </nav>
  );
}
