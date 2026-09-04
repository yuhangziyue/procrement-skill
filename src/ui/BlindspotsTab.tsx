import { useCallback, useEffect, useMemo, useState } from "preact/hooks";
import { itemById } from "../learning/plan";
import {
  KIND_LABEL,
  coverageGaps,
  loadBlindspots,
  newThisWeek,
  rankBlindspots,
  setBlindspotStatus,
  topicLabel,
  type Blindspot,
  type BlindspotKind,
  type BlindspotStatus,
} from "../learning/blindspots";
import { onBlindspotChange } from "../tools/blindspot";
import { Icon, type IconName } from "./icons";
import "./BlindspotsTab.css";

// 这一页的叙事是「地图」不是「耻辱墙」（见 docs/DESIGN-blindspots.md §〇）：
// 不出现分数、不出现「你不懂 X」，每条只说三件事——你当时说了什么、不纠正会怎样、正确口径是什么。
// 全部 SVG 图标，无 emoji。

const KIND_ICON: Record<BlindspotKind, IconName> = {
  wrong_metric: "gap",
  process_gap: "warning",
  misconception: "alert",
  unknown: "book",
};

const STATUS_ACTIONS: { status: BlindspotStatus; label: string; icon?: IconName }[] = [
  { status: "open", label: "先放着" },
  { status: "learning", label: "我要学", icon: "learning" },
  { status: "cleared", label: "已经懂了", icon: "check" },
];

export function BlindspotsTab({
  onOpenItem,
  onAskAgent,
}: {
  /** 点「关联学习条目」跳到学习计划里那一条 */
  onOpenItem?: (itemId: string) => void;
  onAskAgent?: (q: string) => void;
}) {
  const [list, setList] = useState<Blindspot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  const refresh = useCallback(async () => {
    try {
      setList(await loadBlindspots());
    } catch (err: any) {
      setError(`读盲区记录失败：${err?.message ?? String(err)}（不影响聊天，记录可能存不下）`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    return onBlindspotChange(() => void refresh());
  }, [refresh]);

  const ranked = useMemo(() => rankBlindspots(list), [list]);
  const gaps = useMemo(() => coverageGaps(list), [list]);
  const fresh = useMemo(() => newThisWeek(list), [list]);
  const repeated = useMemo(() => ranked.filter((b) => b.occurrences > 1 && b.status !== "cleared").slice(0, 3), [ranked]);
  const openCount = ranked.filter((b) => b.status !== "cleared").length;

  const change = async (b: Blindspot, status: BlindspotStatus) => {
    setList((cur) => cur.map((x) => (x.id === b.id ? { ...x, status } : x))); // 界面不等 IO
    try {
      setList(await setBlindspotStatus(b.id, status));
    } catch (err: any) {
      setError(`状态没存下来：${err?.message ?? String(err)}`);
    }
  };

  if (loading) {
    return (
      <section class="bs">
        <div class="bs-skeleton" />
        <div class="bs-skeleton" />
        <div class="bs-skeleton short" />
      </section>
    );
  }

  if (ranked.length === 0) {
    return (
      <section class="bs">
        {error && <p class="error bs-error">{error}</p>}
        <div class="bs-empty">
          <Icon name="sparkle" size={26} tone="muted" />
          <p class="bs-empty-title">还没发现盲区。</p>
          <p class="muted">多和小采聊几轮，它会边聊边记。记下来的都会带上你当时的原话和一句正确口径，不打分、不排名。</p>
        </div>
      </section>
    );
  }

  return (
    <section class="bs">
      {error && <p class="error bs-error">{error}</p>}

      <div class="bs-summary">
        <div class="bs-sum-nums">
          <span class="bs-sum-n">{openCount}</span>
          <span class="muted"> 条待补 · 本周新增 {fresh} 条</span>
        </div>
        {repeated.length > 0 && (
          <div class="bs-sum-rep">
            <span class="bs-sum-label">反复出现的</span>
            <ol>
              {repeated.map((b) => (
                <li key={b.id}>
                  {b.title}
                  <span class="muted"> · {b.occurrences} 次</span>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>

      {gaps.length > 0 && (
        <div class="bs-gaps">
          {gaps.slice(0, 3).map((g) => (
            <p key={g.topic}>
              <Icon name="alert" size={14} tone="warn" />
              <span>
                <b>{topicLabel(g.topic)}</b> —— {g.hint}
              </span>
            </p>
          ))}
        </div>
      )}

      <div class="bs-list">
        {ranked.map((b) => (
          <article key={b.id} class={`bs-card bs-${b.status} bs-kind-${b.kind}`}>
            <header class="bs-card-head">
              <span class={`bs-badge bs-kind-${b.kind}`}>
                <Icon name={KIND_ICON[b.kind]} size={13} />
                {KIND_LABEL[b.kind]}
              </span>
              <h4 class="bs-card-title">{b.title}</h4>
              {b.occurrences > 1 && <span class="bs-times">出现 {b.occurrences} 次</span>}
            </header>

            <blockquote class="bs-evidence">
              <span class="bs-block-label">你当时说</span>
              <p>{b.evidence}</p>
            </blockquote>

            {b.why && (
              <div class="bs-why">
                <span class="bs-block-label">不纠正会怎样</span>
                <p>{b.why}</p>
              </div>
            )}

            {b.fix && (
              <div class="bs-fix">
                <span class="bs-block-label">
                  <Icon name="check" size={12} tone="ok" /> 正确口径
                </span>
                <p>{b.fix}</p>
              </div>
            )}

            {b.linkedItemIds.length > 0 && (
              <div class="bs-links">
                <span class="bs-block-label">对应学习计划</span>
                <div class="bs-link-row">
                  {b.linkedItemIds.map((id) => {
                    const it = itemById(id);
                    return it ? (
                      <button key={id} class="bs-link" onClick={() => onOpenItem?.(id)} disabled={!onOpenItem}>
                        <span>第 {it.week} 周 · {it.title}</span>
                        <Icon name="chevronRight" size={13} />
                      </button>
                    ) : null;
                  })}
                </div>
              </div>
            )}

            <footer class="bs-actions">
              {STATUS_ACTIONS.map((a) => (
                <button
                  key={a.status}
                  class={`btn btn-sm bs-state${b.status === a.status ? " bs-state-on" : ""}`}
                  aria-pressed={b.status === a.status}
                  onClick={() => change(b, a.status)}
                >
                  {a.icon && <Icon name={a.icon} size={13} />}
                  {a.label}
                </button>
              ))}
              <button
                class="btn btn-sm"
                disabled={!onAskAgent}
                onClick={() =>
                  onAskAgent?.(
                    `采姐，这条我一直搞错：「${b.title}」。\n我当时说的是：${b.evidence}\n` +
                      `正确口径我记的是：${b.fix || "（还没记住）"}\n` +
                      `请用我们厂的情况给我讲一遍为什么，再给我一句下次自查用的话。`,
                  )
                }
              >
                问采姐
              </button>
            </footer>
          </article>
        ))}
      </div>
    </section>
  );
}
