import { useEffect, useMemo, useState } from "preact/hooks";
import {
  CHAPTERS,
  ITEMS,
  TRACKS,
  TRACK_LABELS,
  WEEKLY_MINUTES_CAP,
  blockedBy,
  chapterOf,
  nextUp,
  planByWeek,
  readiness,
  type LearningItem,
  type Track,
} from "../learning/plan";
import {
  computeStats,
  loadProgress,
  setItemStatus,
  setSelfRating,
  type ItemStatus,
  type Progress,
} from "../learning/progress";
import "./LearningView.css";

// 视觉语言跟 MaterialsPanel / KnowledgePanel 走：基础 .btn / .muted / .ok 来自 styles.css，
// 这里只加 .lv-* 前缀类。这一页**没有分数、没有及格线**（苏姐 §6 砍掉测验），
// 星星只是"我自己觉得有几成把握"，可以不点。

const STATUS_LABEL: Record<ItemStatus, string> = { todo: "没开始", doing: "在学", done: "学会了" };
const STATUS_NEXT: Record<ItemStatus, ItemStatus> = { todo: "doing", doing: "done", done: "todo" };
const TRACK_ICON: Record<Track, string> = { basics: "📐", system: "🖥", collab: "🤝", supplier: "📦" };

type Mode = "week" | "track";

export function LearningView({
  onAskAgent,
  onOpenTutorial,
}: {
  onAskAgent?: (q: string) => void;
  onOpenTutorial?: (id: string) => void;
}) {
  const [progress, setProgress] = useState<Progress>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [mode, setMode] = useState<Mode>("week");
  const [openId, setOpenId] = useState<string>();

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const p = await loadProgress();
        if (alive) setProgress(p);
      } catch (err: any) {
        if (alive) setError(`读学习进度失败：${err?.message ?? String(err)}（不影响看内容，勾选可能存不下）`);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const stats = useMemo(() => computeStats(progress), [progress]);
  const ready = useMemo(() => readiness(stats.doneIds), [stats.doneIds]);
  const upcoming = useMemo(() => nextUp(stats.doneIds, 3), [stats.doneIds]);
  const weeks = useMemo(() => planByWeek(), []);

  const cycle = async (item: LearningItem) => {
    const cur = progress[item.id]?.status ?? "todo";
    const next = STATUS_NEXT[cur];
    // 先本地更新，界面不等 IO
    setProgress((p) => ({
      ...p,
      [item.id]: {
        itemId: item.id,
        status: next,
        score: p[item.id]?.score ?? null,
        note: p[item.id]?.note ?? null,
        startedAt: p[item.id]?.startedAt ?? null,
        doneAt: p[item.id]?.doneAt ?? null,
        updatedAt: new Date().toISOString(),
      },
    }));
    try {
      const row = await setItemStatus(item.id, next);
      setProgress((p) => ({ ...p, [item.id]: row }));
    } catch (err: any) {
      setError(`状态没存下来：${err?.message ?? String(err)}`);
    }
  };

  const rate = async (item: LearningItem, score: number | null) => {
    try {
      const row = await setSelfRating(item.id, score);
      setProgress((p) => ({ ...p, [item.id]: row }));
    } catch (err: any) {
      setError(`自评没存下来：${err?.message ?? String(err)}`);
    }
  };

  const card = (item: LearningItem) => (
    <ItemCard
      key={item.id}
      item={item}
      status={progress[item.id]?.status ?? "todo"}
      score={progress[item.id]?.score ?? null}
      locked={blockedBy(item, stats.doneIds)}
      expanded={openId === item.id}
      onToggle={() => setOpenId(openId === item.id ? undefined : item.id)}
      onCycle={() => cycle(item)}
      onRate={(s) => rate(item, s)}
      onAskAgent={onAskAgent}
      onOpenTutorial={onOpenTutorial}
    />
  );

  if (loading) {
    return (
      <div class="lv">
        <div class="lv-loading">
          <div class="lv-skeleton" />
          <div class="lv-skeleton" />
          <div class="lv-skeleton short" />
          <p class="muted">在读你的学习进度…</p>
        </div>
      </div>
    );
  }

  return (
    <div class="lv">
      <header class="lv-head">
        <div>
          <h2 class="lv-title">学习计划 · 16 周补齐 20 个盲区</h2>
          <p class="muted lv-sub">
            这不是考卷，是地图。没有测验、没有及格线——每条只问三件事：怎么学、在工作里做什么、拿什么证明学会了。
          </p>
        </div>
        <div class="lv-total">
          <b>{stats.done}</b>
          <span class="muted"> / {stats.total} 条</span>
          <div class="muted lv-total-min">
            已投入 {stats.minutesDone} 分钟 · 全程约 {Math.round(stats.minutesTotal / 60)} 小时
          </div>
        </div>
      </header>

      {error && <p class="error lv-error">{error}</p>}

      <section class="lv-tracks">
        {ready.map((r) => {
          const pct = r.total ? Math.round((r.done / r.total) * 100) : 0;
          return (
            <div key={r.track} class={`lv-track lv-track-${r.track}`}>
              <div class="lv-track-top">
                <span class="lv-track-name">
                  {TRACK_ICON[r.track]} {TRACK_LABELS[r.track]}
                </span>
                <span class="muted lv-track-count">
                  {r.done}/{r.total}
                </span>
              </div>
              <div class="lv-bar">
                <i style={{ width: `${pct}%` }} />
              </div>
              <div class="lv-track-gap">
                {r.gaps.length ? `还差：${r.gaps.join(" · ")}` : "这条赛道全通了"}
              </div>
            </div>
          );
        })}
      </section>

      <section class="lv-next">
        <h3 class="lv-h3">本周要学的 3 件事</h3>
        {upcoming.length === 0 ? (
          <p class="lv-allclear">
            48 条全部学完了。20 条盲区全通 —— 你现在是这两家供应商 152 项料的唯一明白人。
          </p>
        ) : (
          <ol class="lv-next-list">
            {upcoming.map((i) => (
              <li key={i.id}>
                <button class="lv-next-item" onClick={() => setOpenId(i.id)}>
                  <span class="lv-next-week">第 {i.week} 周</span>
                  <span class="lv-next-title">{i.title}</span>
                  <span class="muted lv-next-min">{i.minutes} 分钟</span>
                </button>
              </li>
            ))}
          </ol>
        )}
      </section>

      <div class="lv-modes">
        <button class={`btn btn-sm${mode === "week" ? " btn-primary" : ""}`} onClick={() => setMode("week")}>
          按周
        </button>
        <button class={`btn btn-sm${mode === "track" ? " btn-primary" : ""}`} onClick={() => setMode("track")}>
          按赛道
        </button>
        <span class="muted lv-modes-hint">
          每周不超过 {WEEKLY_MINUTES_CAP} 分钟 —— 你要上班，排满就等于排空。
        </span>
      </div>

      {mode === "week" ? (
        <section class="lv-timeline">
          {weeks.map((w) => {
            const wDone = w.items.filter((i) => stats.doneIds.has(i.id)).length;
            return (
              <div key={w.week} class={`lv-week${wDone === w.items.length && w.items.length ? " done" : ""}`}>
                <div class="lv-week-head">
                  <span class="lv-week-no">第 {w.week} 周</span>
                  <span class="lv-week-theme">{w.theme}</span>
                  <span class="muted lv-week-meta">
                    {wDone}/{w.items.length} · {w.totalMinutes} 分钟
                  </span>
                </div>
                {w.items.length === 0 ? (
                  <p class="muted lv-week-empty">这周没排东西，用来补前面欠的。</p>
                ) : (
                  <div class="lv-cards">{w.items.map(card)}</div>
                )}
              </div>
            );
          })}
        </section>
      ) : (
        <section class="lv-columns">
          {TRACKS.map((t) => (
            <div key={t.id} class="lv-col">
              <div class={`lv-col-head lv-track-${t.id}`}>
                <b>
                  {TRACK_ICON[t.id]} {t.name}
                </b>
                <span class="muted">{t.blurb}</span>
              </div>
              {CHAPTERS.filter((c) => c.track === t.id).map((c) => (
                <div key={c.id} class="lv-chapter">
                  <div class="lv-chapter-name">{c.name}</div>
                  <div class="lv-chapter-goal">{c.goal}</div>
                  <div class="lv-cards">
                    {c.items.map((id) => {
                      const it = ITEMS.find((x) => x.id === id);
                      return it ? card(it) : null;
                    })}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function ItemCard({
  item,
  status,
  score,
  locked,
  expanded,
  onToggle,
  onCycle,
  onRate,
  onAskAgent,
  onOpenTutorial,
}: {
  item: LearningItem;
  status: ItemStatus;
  score: number | null;
  locked: LearningItem[];
  expanded: boolean;
  onToggle: () => void;
  onCycle: () => void;
  onRate: (score: number | null) => void;
  onAskAgent?: (q: string) => void;
  onOpenTutorial?: (id: string) => void;
}) {
  const chapter = chapterOf(item.id);
  const tutorial = (item.refs ?? []).find((r) => r.kind === "tutorial");
  const ask = () =>
    onAskAgent?.(
      `采姐，学习计划第 ${item.week} 周这条我想弄明白：「${item.title}」。\n` +
        `不懂的后果是：${item.why}\n` +
        `我要做的实操是：${item.practice}\n` +
        `请用我们厂的情况（食品厂包材、152 项、2 家供应商、5 项日配件、用友 U8+）给我讲一遍，最后给我一句能直接照着问的话术。`,
    );

  return (
    <article class={`lv-card lv-${status}${expanded ? " open" : ""}`}>
      <div class="lv-card-head">
        <button class="lv-card-title" onClick={onToggle} title={expanded ? "收起" : "展开"}>
          {locked.length > 0 && <span class="lv-lock" title={`前置未完成：${locked.map((l) => l.title).join("、")}`}>🔒</span>}
          <span>{item.title}</span>
        </button>
        <div class="lv-card-right">
          <span class="muted lv-min">{item.minutes} 分</span>
          <button class={`lv-status lv-status-${status}`} onClick={onCycle} title="点一下换状态">
            {STATUS_LABEL[status]}
          </button>
        </div>
      </div>

      <div class="lv-card-meta">
        <span class={`lv-tag lv-track-${item.track}`}>{TRACK_LABELS[item.track]}</span>
        <span class="muted">第 {item.week} 周</span>
        {chapter && <span class="muted">· {chapter.name}</span>}
      </div>

      {locked.length > 0 && (
        <p class="lv-locked-hint">
          🔒 建议先学：{locked.map((l) => l.title).join("、")}。想先看也行，这里不拦你。
        </p>
      )}

      {expanded && (
        <div class="lv-body">
          <div class="lv-block lv-why">
            <div class="lv-block-label">不懂会出什么事</div>
            <p>{item.why}</p>
          </div>

          <div class="lv-block">
            <div class="lv-block-label">怎么学</div>
            <ul class="lv-learn">
              {item.learn.map((l, k) => (
                <li key={k}>{l}</li>
              ))}
            </ul>
          </div>

          <div class="lv-block">
            <div class="lv-block-label">实操任务（在真实工作里做）</div>
            <p>{item.practice}</p>
          </div>

          <div class="lv-block lv-proof">
            <div class="lv-block-label">学会了的凭据</div>
            <p>{item.proof}</p>
          </div>

          {(item.refs ?? []).length > 0 && (
            <div class="lv-block">
              <div class="lv-block-label">参考</div>
              <ul class="lv-refs">
                {(item.refs ?? []).map((r) => (
                  <li key={`${r.kind}-${r.id}`}>
                    <span class="lv-ref-kind">{r.kind === "tutorial" ? "教程" : r.kind === "sop" ? "SOP" : "知识卡"}</span>
                    {r.label}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div class="lv-rate">
            <span class="lv-block-label">自评把握程度</span>
            <div class="lv-stars">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  class={`lv-star${score != null && n <= score ? " on" : ""}`}
                  title={`${n} 星`}
                  onClick={() => onRate(score === n ? null : n)}
                >
                  ★
                </button>
              ))}
              <span class="muted lv-rate-hint">{score == null ? "可以不填 —— 这里不打分、不排名" : `${score} 星`}</span>
            </div>
          </div>

          <div class="lv-actions">
            <button class="btn btn-sm" onClick={ask} disabled={!onAskAgent}>
              问采姐
            </button>
            {tutorial && (
              <button class="btn btn-sm" onClick={() => onOpenTutorial?.(tutorial.id)} disabled={!onOpenTutorial}>
                看教程
              </button>
            )}
          </div>
        </div>
      )}
    </article>
  );
}
