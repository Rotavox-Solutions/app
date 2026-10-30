"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { RuleDraft, RulesSnapshot } from "@rotavox/schema";
import type { ClockCategoryOption } from "@/lib/format-edits";
import type { RulesPreview } from "@/lib/rules-preview";
import type { PreviewRun } from "@/lib/clock-preview";

type Param = { key: string; label: string; unit: string };

/**
 * The rule types the engine enforces, in the order a PD thinks about them. Mirrors
 * RULE_TYPES in @rotavox/schema rules.ts, which validates on save.
 */
const TYPES: {
  type: string;
  label: string;
  help: string;
  params: Param[];
  /** Where a new rule of this type starts. */
  defaultScope: "global" | "category";
  defaults: Record<string, unknown>;
  globalAllowed: boolean;
}[] = [
  {
    type: "artist_separation",
    label: "Artist separation",
    help: "Minutes before the same artist plays again. Station-wide applies to music; a category's rule overrides it for positions playing that category.",
    params: [{ key: "minMinutes", label: "", unit: "minutes" }],
    defaultScope: "global",
    defaults: { minMinutes: 45 },
    globalAllowed: true,
  },
  {
    type: "title_separation",
    label: "Title separation",
    help: "Minutes before the same song plays again.",
    params: [{ key: "minMinutes", label: "", unit: "minutes" }],
    defaultScope: "global",
    defaults: { minMinutes: 150 },
    globalAllowed: true,
  },
  {
    type: "album_separation",
    label: "Album separation",
    help: "Minutes before another song from the same album.",
    params: [{ key: "minMinutes", label: "", unit: "minutes" }],
    defaultScope: "global",
    defaults: { minMinutes: 60 },
    globalAllowed: true,
  },
  {
    type: "horizontal_separation",
    label: "Horizontal separation",
    help: "Keeps a song off the same time of day: it can't play within this many hours of a time it played at, for this many days.",
    params: [
      { key: "windowHours", label: "within", unit: "hours" },
      { key: "minDays", label: "for", unit: "days" },
    ],
    defaultScope: "category",
    defaults: { windowHours: 1, minDays: 7 },
    globalAllowed: true,
  },
  {
    type: "tempo_clash",
    label: "Tempo clash",
    help: "The largest tempo step between neighbouring songs, on the 1–5 tempo scale. Songs with no tempo tag aren't held to it.",
    params: [{ key: "maxJump", label: "at most", unit: "steps" }],
    defaultScope: "global",
    defaults: { maxJump: 2 },
    globalAllowed: true,
  },
  {
    type: "max_per_hour",
    label: "Most per hour",
    help: "At most this many songs from a category and its sub-pools in any hour, however they got there, fallback included.",
    params: [{ key: "count", label: "at most", unit: "an hour" }],
    defaultScope: "category",
    defaults: { count: 4 },
    globalAllowed: false,
  },
  {
    type: "daypart_restrict",
    label: "Only in these hours",
    help: "A category's songs only air on these days and in these hours, however they got there.",
    params: [],
    defaultScope: "category",
    defaults: { hours: [6, 7, 8, 9] },
    globalAllowed: true,
  },
];
const TYPE_BY_KEY = new Map(TYPES.map((t) => [t.type, t]));

const DAYS = [
  { dow: 1, label: "Mon" },
  { dow: 2, label: "Tue" },
  { dow: 3, label: "Wed" },
  { dow: 4, label: "Thu" },
  { dow: 5, label: "Fri" },
  { dow: 6, label: "Sat" },
  { dow: 0, label: "Sun" },
];
const hourLabel = (h: number) => (h === 0 ? "12a" : h < 12 ? `${h}a` : h === 12 ? "12p" : `${h - 12}p`);

/** How the engine relaxes a slot it can't fill cleanly, in a PD's words. */
const STEPS: [string, string][] = [
  ["drop_secondary_hard", "Dropped a secondary rule (horizontal, tempo, per-hour, daypart)"],
  ["shrink_artist", "Shortened artist separation"],
  ["shrink_title", "Shortened title separation"],
  ["fallback_category", "Fell back to another pool"],
  ["last_resort", "Took a last-resort song"],
  ["unfillable", "Left the slot empty"],
];

const field = "rounded border border-neutral-700 bg-neutral-900 px-1.5 py-0.5 text-sm text-neutral-100 disabled:opacity-50";
let nextKey = 0;
const newKey = () => `new-${Date.now()}-${nextKey++}`;
const slotOf = (r: Pick<RuleDraft, "ruleType" | "scope" | "scopeRef">) => `${r.ruleType}|${r.scope}|${r.scope === "global" ? "" : r.scopeRef ?? ""}`;
const shapeOf = (r: RuleDraft) => JSON.stringify([slotOf(r), r.params, r.hardness, r.weight]);

export interface RuleRevisionView {
  id: string;
  savedAt: string;
  note: string | null;
  savedByName: string | null;
  snapshot: RulesSnapshot;
}

/** A revision's rules as a draft, reusing the id of the current rule in the same slot. */
function draftFromSnapshot(snapshot: RulesSnapshot, current: RuleDraft[]): RuleDraft[] {
  const idBySlot = new Map(current.filter((r) => r.id).map((r) => [slotOf(r), r.id!]));
  return snapshot.rules.map((r) => {
    const id = idBySlot.get(slotOf(r)) ?? null;
    return { ...r, id, key: id ?? newKey() };
  });
}

function differing(a: RuleDraft[], b: RuleDraft[]): number {
  const sa = new Set(a.map(shapeOf));
  const sb = new Set(b.map(shapeOf));
  return [...sa].filter((x) => !sb.has(x)).length + [...sb].filter((x) => !sa.has(x)).length;
}

function NumberField({
  value,
  onChange,
  disabled,
  label,
}: {
  value: unknown;
  onChange: (v: number | null) => void;
  disabled?: boolean;
  label: string;
}) {
  const [text, setText] = useState(typeof value === "number" ? String(value) : "");
  useEffect(() => {
    setText((t) => (Number(t) === value && t.trim() !== "" ? t : typeof value === "number" ? String(value) : ""));
  }, [value]);
  return (
    <input
      value={text}
      disabled={disabled}
      inputMode="numeric"
      aria-label={label}
      onChange={(e) => {
        setText(e.target.value);
        const t = e.target.value.trim();
        onChange(t === "" ? null : Number(t));
      }}
      className={`${field} w-16 text-right tabular-nums`}
    />
  );
}

function Toggles<T extends number>({
  items,
  selected,
  onChange,
  disabled,
}: {
  items: { value: T; label: string }[];
  selected: T[] | undefined;
  onChange: (next: T[] | undefined) => void;
  disabled?: boolean;
}) {
  const set = new Set(selected ?? []);
  return (
    <div className="flex flex-wrap gap-0.5">
      {items.map((it) => (
        <button
          key={it.value}
          type="button"
          disabled={disabled}
          onClick={() => {
            const next = new Set(set);
            if (next.has(it.value)) next.delete(it.value);
            else next.add(it.value);
            onChange(next.size ? [...next].sort((a, b) => a - b) : undefined);
          }}
          className={`rounded px-1.5 py-0.5 text-xs ${set.has(it.value) ? "bg-sky-800 text-sky-50" : "bg-neutral-900 text-neutral-500 hover:text-neutral-300"}`}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

function RunSummary({ label, run }: { label: string; run: PreviewRun }) {
  return (
    <div className="rounded border border-neutral-800 px-4 py-3">
      <div className="text-xs text-neutral-500">{label}</div>
      <div className="mt-1 text-sm tabular-nums">
        {run.min.toFixed(1)} – {run.max.toFixed(1)} min hours
        <span className="text-neutral-500"> · median {run.median.toFixed(1)}</span>
      </div>
      <div className="mt-0.5 text-xs text-neutral-500">
        {run.outOfTolerance ? <span className="text-amber-300">{run.outOfTolerance} outside 57–63 min · </span> : null}
        {run.stats.unfillable ? <span className="text-amber-300">{run.stats.unfillable} unfilled · </span> : null}
        {Object.values(run.violations).reduce((a, b) => a + b, 0)} relaxations
      </div>
    </div>
  );
}

export function RulesEditor({
  initial,
  updatedAt,
  categories,
  positionLabels,
  revisions,
  timezone,
  readOnly = false,
}: {
  initial: RuleDraft[];
  updatedAt: string;
  categories: ClockCategoryOption[];
  positionLabels: Record<string, string>;
  revisions: RuleRevisionView[];
  timezone: string;
  readOnly?: boolean;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<RuleDraft[]>(initial);
  const [loadedAt, setLoadedAt] = useState(updatedAt);
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const [saved, setSaved] = useState<string | null>(null);
  const [restoring, setRestoring] = useState<RuleRevisionView | null>(null);
  const [preview, setPreview] = useState<RulesPreview | null>(null);
  const [previewedFor, setPreviewedFor] = useState<string | null>(null);
  const [previewHours, setPreviewHours] = useState(24);
  /** Why a preview couldn't run, shown beside it rather than at the save bar. */
  const [previewProblems, setPreviewProblems] = useState<string[]>([]);
  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(initial), [draft, initial]);

  useEffect(() => {
    setDraft(initial);
    setLoadedAt(updatedAt);
    setRestoring(null);
  }, [initial, updatedAt]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const catName = useMemo(() => new Map(categories.map((c) => [c.id, c.name])), [categories]);
  const when = (iso: string) =>
    new Date(iso).toLocaleString("en-US", { timeZone: timezone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const update = (key: string, patch: Partial<RuleDraft>) => setDraft((d) => d.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const setParam = (r: RuleDraft, k: string, v: unknown) => {
    const params = { ...r.params };
    if (v === undefined) delete params[k];
    else params[k] = v;
    update(r.key, { params });
  };
  const remove = (key: string) => setDraft((d) => d.filter((r) => r.key !== key));
  const add = (type: (typeof TYPES)[number]) =>
    setDraft((d) => [
      ...d,
      {
        id: null,
        key: newKey(),
        ruleType: type.type,
        scope: type.defaultScope,
        scopeRef: null,
        params: { ...type.defaults },
        hardness: "hard",
        weight: null,
      },
    ]);

  const active = draft.filter((r) => r.hardness === "hard" && TYPE_BY_KEY.has(r.ruleType));
  const inactive = draft.filter((r) => !(r.hardness === "hard" && TYPE_BY_KEY.has(r.ruleType)));
  const ro = readOnly || pending;

  async function send(url: string, method: string, body: unknown) {
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  }

  async function save() {
    setPending(true);
    setProblems([]);
    setSaved(null);
    try {
      const { ok, status, data } = await send("/api/rules", "PUT", { rules: draft, expectedUpdatedAt: loadedAt, note });
      if (!ok) setProblems(data.problems?.length ? data.problems : [data.message ?? `Save failed (${status})`]);
      else {
        setNote("");
        setSaved("Saved. Logs generated from now on use these rules.");
        router.refresh();
      }
    } catch {
      setProblems(["Save failed — is the Cockpit reachable?"]);
    }
    setPending(false);
  }

  async function runPreview() {
    setPending(true);
    setPreviewProblems([]);
    try {
      const { ok, status, data } = await send("/api/rules/preview", "POST", { rules: draft, hours: previewHours });
      if (!ok) setPreviewProblems(data.problems?.length ? data.problems : [data.message ?? `Preview failed (${status})`]);
      else {
        setPreview(data);
        setPreviewedFor(JSON.stringify(draft));
      }
    } catch {
      setPreviewProblems(["Preview failed — is the Cockpit reachable?"]);
    }
    setPending(false);
  }

  const scopeCell = (r: RuleDraft, def: (typeof TYPES)[number]) => {
    if (r.scope === "position") {
      return <span className="text-neutral-300">{positionLabels[r.scopeRef ?? ""] ?? "a clock position"}</span>;
    }
    return (
      <select
        value={r.scope === "global" ? "" : r.scopeRef ?? "?"}
        disabled={ro}
        onChange={(e) =>
          update(r.key, e.target.value ? { scope: "category", scopeRef: e.target.value } : { scope: "global", scopeRef: null })
        }
        className={`${field} max-w-[12rem]`}
        aria-label={`What ${def.label.toLowerCase()} applies to`}
      >
        {def.globalAllowed && <option value="">Station-wide</option>}
        {!def.globalAllowed && r.scope === "global" && <option value="">Choose a category…</option>}
        {r.scope === "category" && !r.scopeRef && <option value="?">Choose a category…</option>}
        {categories.map((c) => (
          <option key={c.id} value={c.id}>
            {c.group ? `${c.group} › ` : ""}
            {c.name}
          </option>
        ))}
      </select>
    );
  };

  const stale = preview && previewedFor !== JSON.stringify(draft);

  return (
    <div className="space-y-6">
      {restoring && dirty && (
        <p className="rounded border border-sky-900 bg-sky-950/40 px-3 py-2 text-sm text-sky-100">
          Loaded the rules of {when(restoring.savedAt)} into the editor. Preview them, then save to restore them, or discard
          changes to leave the rules as they are.
        </p>
      )}

      {TYPES.map((def) => {
        const list = active.filter((r) => r.ruleType === def.type);
        return (
          <section key={def.type} className="space-y-1.5">
            <div className="flex flex-wrap items-baseline gap-3">
              <h2 className="text-sm font-medium text-neutral-200">{def.label}</h2>
              <p className="text-xs text-neutral-500">{def.help}</p>
            </div>
            {list.length === 0 ? (
              <p className="text-sm text-neutral-600">None.</p>
            ) : (
              <ul className="space-y-1">
                {list.map((r) => (
                  <li key={r.key} className="flex flex-wrap items-center gap-2 text-sm">
                    {scopeCell(r, def)}
                    {def.params.map((p) => (
                      <span key={p.key} className="flex items-center gap-1 text-neutral-400">
                        {p.label}
                        <NumberField
                          value={r.params[p.key]}
                          onChange={(v) => setParam(r, p.key, v ?? undefined)}
                          disabled={ro}
                          label={`${def.label} ${p.unit}`}
                        />
                        {p.unit}
                      </span>
                    ))}
                    {def.type === "daypart_restrict" && (
                      <div className="flex flex-col gap-1">
                        <Toggles
                          items={DAYS.map((d) => ({ value: d.dow, label: d.label }))}
                          selected={r.params.days as number[] | undefined}
                          onChange={(v) => setParam(r, "days", v)}
                          disabled={ro}
                        />
                        <Toggles
                          items={Array.from({ length: 24 }, (_, h) => ({ value: h, label: hourLabel(h) }))}
                          selected={r.params.hours as number[] | undefined}
                          onChange={(v) => setParam(r, "hours", v)}
                          disabled={ro}
                        />
                        <span className="text-xs text-neutral-500">No days chosen means every day; no hours, every hour.</span>
                      </div>
                    )}
                    {!readOnly && (
                      <button onClick={() => remove(r.key)} disabled={ro} className="text-xs text-red-400 hover:text-red-300">
                        Remove
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {!readOnly && (
              <button onClick={() => add(def)} disabled={ro} className="text-xs text-sky-300 hover:underline">
                Add {def.label.toLowerCase()}
              </button>
            )}
          </section>
        );
      })}

      {inactive.length > 0 && (
        <section className="space-y-1.5 rounded border border-neutral-800 p-3">
          <h2 className="text-sm font-medium text-neutral-300">Not in effect</h2>
          <p className="text-xs text-neutral-500">
            The generator doesn&apos;t use these: soft rules are ignored (song scoring is set in the engine), and so are rule
            types it doesn&apos;t know. They&apos;re kept until removed.
          </p>
          <ul className="space-y-1 text-sm">
            {inactive.map((r) => (
              <li key={r.key} className="flex flex-wrap items-center gap-3 text-neutral-400">
                <span>{r.ruleType.replace(/_/g, " ")}</span>
                <span className="text-xs">
                  {r.scope === "global" ? "station-wide" : r.scope === "category" ? catName.get(r.scopeRef ?? "") ?? "a category" : positionLabels[r.scopeRef ?? ""] ?? "a position"}
                  {" · "}
                  {r.hardness}
                  {r.weight != null ? ` · weight ${r.weight}` : ""}
                  {Object.keys(r.params).length ? ` · ${JSON.stringify(r.params)}` : ""}
                </span>
                {!readOnly && (
                  <button onClick={() => remove(r.key)} disabled={ro} className="text-xs text-red-400 hover:text-red-300">
                    Remove
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {!readOnly && (
        <section className="space-y-3 rounded border border-neutral-800 p-4">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500">Preview</h2>
            <select
              value={previewHours}
              onChange={(e) => setPreviewHours(Number(e.target.value))}
              className="rounded border border-neutral-700 bg-neutral-900 px-2 py-0.5 text-sm text-neutral-100"
              aria-label="Hours to preview"
            >
              {[6, 12, 24].map((h) => (
                <option key={h} value={h}>
                  next {h} hours
                </option>
              ))}
            </select>
            <button
              onClick={runPreview}
              disabled={pending}
              className="rounded border border-neutral-700 px-3 py-1 text-sm text-neutral-200 hover:bg-neutral-900 disabled:opacity-50"
            >
              {pending ? "Working…" : dirty ? "Preview these rules" : "Preview the rules"}
            </button>
            <span className="text-xs text-neutral-500">Generates on the real week grid with live songs and play history. Nothing is saved.</span>
          </div>
          {previewProblems.length > 0 && (
            <ul className="space-y-0.5 text-sm text-red-300">
              {previewProblems.map((p) => (
                <li key={p}>Fix first: {p}</li>
              ))}
            </ul>
          )}
          {preview && (
            <div className={`space-y-3 ${stale ? "opacity-60" : ""}`}>
              {stale && <p className="text-xs text-amber-300">The rules have changed since this preview. Run it again.</p>}
              <div className="grid gap-3 md:grid-cols-2">
                <RunSummary label="Saved rules" run={preview.saved} />
                <RunSummary label="These rules" run={preview.draft} />
              </div>
              <table className="text-sm">
                <thead>
                  <tr className="text-xs text-neutral-500">
                    <th className="pr-6 text-left font-medium">To fill a slot, the generator…</th>
                    <th className="px-3 text-right font-medium">Saved</th>
                    <th className="px-3 text-right font-medium">These</th>
                  </tr>
                </thead>
                <tbody>
                  {STEPS.map(([step, label]) => {
                    const a = preview.saved.violations[step] ?? 0;
                    const b = preview.draft.violations[step] ?? 0;
                    return (
                      <tr key={step}>
                        <td className="pr-6 text-neutral-400">{label}</td>
                        <td className="px-3 text-right tabular-nums">{a}</td>
                        <td className={`px-3 text-right tabular-nums ${b > a ? "text-amber-300" : b < a ? "text-emerald-300" : ""}`}>{b}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {!readOnly && (
        <div className="space-y-3">
          {problems.length > 0 && (
            <ul className="space-y-0.5 rounded border border-red-900/60 bg-red-950/30 p-3 text-sm text-red-300">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
          {saved && !dirty && <p className="text-sm text-emerald-300">{saved}</p>}
          <div className="flex flex-wrap items-center gap-3 border-t border-neutral-800 pt-3">
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              disabled={ro}
              placeholder="What changed and why (optional)"
              className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm text-neutral-100 sm:w-96"
            />
            <button
              onClick={save}
              disabled={ro || !dirty}
              className="rounded bg-blue-700 px-4 py-1 text-sm font-medium text-white hover:bg-blue-600 disabled:opacity-50"
            >
              {pending ? "Working…" : "Save rules"}
            </button>
            {dirty && (
              <button
                onClick={() => {
                  setDraft(initial);
                  setProblems([]);
                  setRestoring(null);
                  setNote("");
                }}
                disabled={ro}
                className="text-sm text-neutral-400 hover:text-neutral-200"
              >
                Discard changes
              </button>
            )}
            <span className="text-xs text-neutral-500">
              {dirty ? "Unsaved changes." : "No changes."} Saving changes only logs generated afterwards.
            </span>
          </div>
        </div>
      )}

      <section className="space-y-2 pt-2">
        <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500">History</h2>
        {revisions.length === 0 ? (
          <p className="text-sm text-neutral-500">Not edited in Rotavox yet. The first save also keeps the rules as they stand now.</p>
        ) : (
          <ul className="text-sm">
            {revisions.map((r, i) => {
              const n = differing(draftFromSnapshot(r.snapshot, initial), initial);
              return (
                <li key={r.id} className="flex flex-wrap items-baseline gap-x-3 border-b border-neutral-900 py-1.5">
                  <span className="w-32 shrink-0 tabular-nums text-neutral-400">{when(r.savedAt)}</span>
                  <span className="text-neutral-300">{r.savedByName ?? (i === revisions.length - 1 ? "Before Rotavox" : "—")}</span>
                  <span className="text-neutral-500">{r.note ?? ""}</span>
                  <span className={`text-xs ${n ? "text-neutral-500" : "text-emerald-300"}`}>
                    {n ? `${n} ${n === 1 ? "rule differs" : "rules differ"}` : i === 0 ? "current" : "same as now"}
                  </span>
                  {!readOnly && n > 0 && (
                    <button
                      onClick={() => {
                        setDraft(draftFromSnapshot(r.snapshot, initial));
                        setRestoring(r);
                        setProblems([]);
                        setSaved(null);
                        setNote(`Restored the rules of ${when(r.savedAt)}`);
                        window.scrollTo({ top: 0, behavior: "smooth" });
                      }}
                      disabled={pending}
                      className="text-xs text-sky-300 hover:underline disabled:opacity-50"
                    >
                      Load into editor
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
