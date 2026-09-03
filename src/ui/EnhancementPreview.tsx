import { useMemo, useState } from "preact/hooks";
import type { EnhancementRow } from "../db/schema";
import { cleanLines, findConflicts, type EnhancementDraft } from "../db/enhancements";
import "./EnhancementsPanel.css";

interface Props {
  /** 草稿（新卡）或已有卡（编辑）。带 id 时视为编辑，冲突计算会排除自己 */
  draft: EnhancementDraft & { id?: string };
  /** 打开时已算好的冲突卡 */
  conflicts: EnhancementRow[];
  /** 可选：传入全部卡后，用户改触发词时实时重算冲突 */
  existing?: EnhancementRow[];
  /** 标题，默认「预览这张卡」 */
  title?: string;
  onConfirm: (edited: EnhancementDraft) => void;
  onCancel: () => void;
}

type ListKey = "intents" | "triggers" | "sop" | "cautions" | "examples";

const LIST_FIELDS: { key: ListKey; label: string; hint: string; rows: number }[] = [
  { key: "intents", label: "意图（一行一条）", hint: "她想干什么，如：新品缺料要下单", rows: 2 },
  { key: "triggers", label: "触发词（一行一条）", hint: "她怎么问会命中这张卡，如：催货", rows: 3 },
  { key: "sop", label: "流程（一行一步）", hint: "第一步、第二步……", rows: 5 },
  { key: "cautions", label: "注意事项（一行一条）", hint: "容易踩的坑", rows: 3 },
  { key: "examples", label: "示例（一行一条）", hint: "示范一句话怎么说", rows: 3 },
];

/** 「教它」草稿 / 编辑卡的预览确认模态。确认前不落库。 */
export function EnhancementPreview({ draft, conflicts, existing, title, onConfirm, onCancel }: Props) {
  const [name, setName] = useState(draft.name);
  const [lists, setLists] = useState<Record<ListKey, string>>({
    intents: draft.intents.join("\n"),
    triggers: draft.triggers.join("\n"),
    sop: draft.sop.join("\n"),
    cautions: draft.cautions.join("\n"),
    examples: draft.examples.join("\n"),
  });

  const triggers = useMemo(() => cleanLines(lists.triggers.split("\n")), [lists.triggers]);
  const liveConflicts = useMemo(
    () => (existing ? findConflicts({ id: draft.id, triggers }, existing) : conflicts),
    [existing, conflicts, triggers, draft.id],
  );

  const canConfirm = name.trim().length > 0 && triggers.length > 0;

  const confirm = () => {
    if (!canConfirm) return;
    onConfirm({
      ...draft,
      name: name.trim(),
      intents: cleanLines(lists.intents.split("\n")),
      triggers,
      sop: cleanLines(lists.sop.split("\n")),
      cautions: cleanLines(lists.cautions.split("\n")),
      examples: cleanLines(lists.examples.split("\n")),
    });
  };

  return (
    <div class="enh-modal-backdrop" onClick={onCancel}>
      <div class="enh-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <header class="enh-modal-head">
          <h3>{title ?? (draft.id ? "编辑这张卡" : "预览这张卡")}</h3>
          <button class="btn-link" onClick={onCancel}>取消</button>
        </header>

        <p class="muted">
          {draft.id ? "改完点保存生效。" : "小采根据你的话整理成了这张卡。确认后才会记住，之后命中触发词就照这张卡执行。"}
        </p>

        <label class="enh-field">
          名称
          <input value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} placeholder="给这张卡起个名，如：催货三步" />
        </label>

        {LIST_FIELDS.map((f) => (
          <label key={f.key} class="enh-field">
            {f.label}
            <textarea
              rows={f.rows}
              value={lists[f.key]}
              placeholder={f.hint}
              onInput={(e) => setLists({ ...lists, [f.key]: (e.target as HTMLTextAreaElement).value })}
            />
          </label>
        ))}

        {liveConflicts.length > 0 && (
          <div class="enh-conflict">
            <strong>触发词与已启用的卡重叠：</strong>
            <ul>
              {liveConflicts.map((c) => (
                <li key={c.id}>
                  《{c.name}》—— {c.triggers.filter((t) => triggers.some((x) => overlap(t, x))).join("、") || c.triggers.join("、")}
                </li>
              ))}
            </ul>
            <span class="muted">不会自动覆盖。保存后两张都标黄，在「增强卡」里点选哪张生效；也可以现在改触发词避开。</span>
          </div>
        )}

        <footer class="enh-modal-foot">
          <button class="btn" onClick={onCancel}>取消</button>
          <button class="btn btn-primary" disabled={!canConfirm} onClick={confirm}>
            {draft.id ? "保存" : "确认记住"}
          </button>
          {!canConfirm && <span class="muted enh-inline-hint">名称和至少一个触发词必填</span>}
        </footer>
      </div>
    </div>
  );
}

const overlap = (a: string, b: string) => {
  const x = a.trim().toLowerCase();
  const y = b.trim().toLowerCase();
  return !!x && !!y && (x === y || x.includes(y) || y.includes(x));
};
