"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { ClockDraft, ClockPositionDraft, ClockSnapshot, PositionKind } from "@rotavox/schema";
import type { ClockCategoryOption } from "@/lib/format-edits";
import { ClockPreviewPanel } from "./ClockPreviewPanel";
import { describeDifference, draftFromSnapshot } from "./revisions";

export interface ClockRevisionView {
  id: string;
  savedAt: string;
  note: string | null;
  savedByName: string | null;
  snapshot: ClockSnapshot;
}

const KIND_LABEL: Record<PositionKind, string> = {
  category: "Music",
  sweeper: "Imaging",
  voicetrack: "Voice track",
  fixed_event: "Fixed event",
};
/** Which category kind each position kind normally plays, to list those first. */
const PLAYS_KIND: Record<PositionKind, string | null> = {
  category: "music",
  sweeper: "imaging",
  voicetrack: "voicetrack",
  fixed_event: null,
};

const field = "rounded border border-neutral-700 bg-neutral-900 px-1.5 py-0.5 text-sm text-neutral-100 disabled:opacity-50";

function fmtOffset(s: number | null): string {
  if (s == null) return "";
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** "0", ":00", "15:30", "15" (minutes) → seconds; "" → null; anything else → NaN. */
function parseOffset(text: string): number | null {
  const t = text.trim();
  if (!t) return null;
  const m = /^(\d{0,3}):(\d{1,2})$/.exec(t);
  if (m) return Number(m[1] || 0) * 60 + Number(m[2]);
  return /^\d+$/.test(t) ? Number(t) * 60 : NaN;
}

const intOrNull = (text: string) => (text.trim() === "" ? null : Number(text));

let nextKey = 0;
const newKey = () => `new-${Date.now()}-${nextKey++}`;

function blankPosition(kind: PositionKind = "category"): ClockPositionDraft {
  return {
    id: null,
    key: newKey(),
    kind,
    categoryId: null,
    fallbackCategoryId: null,
    targetOffsetSeconds: null,
    fillerPriority: null,
    trimPriority: null,
    anchorKey: null,
    fixedDurationSeconds: kind === "fixed_event" ? 0 : null,
    fixedRef: null,
    extra: {},
  };
}

function CategorySelect({
  value,
  onChange,
  options,
  prefer,
  placeholder,
  disabled,
  label,
}: {
  value: string | null;
  onChange: (id: string | null) => void;
  options: ClockCategoryOption[];
  prefer: string | null;
  placeholder: string;
  disabled?: boolean;
  label: string;
}) {
  // The position's own kind first, grouped by parent; everything else after, so an
  // unusual existing value is still shown rather than silently dropped.
  const groups = new Map<string, ClockCategoryOption[]>();
  const sorted = [...options].sort(
    (a, b) => Number(a.kind !== prefer) - Number(b.kind !== prefer) || (a.group ?? "").localeCompare(b.group ?? "")
  );
  for (const o of sorted) {
    const key = o.kind === prefer ? o.group ?? (o.kind === "music" ? "Music" : o.kind === "imaging" ? "Imaging" : "Voice tracks") : `Other: ${o.kind}`;
    groups.set(key, [...(groups.get(key) ?? []), o]);
  }
  return (
    <select
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value || null)}
      disabled={disabled}
      className={`${field} max-w-[11rem]`}
      aria-label={label}
    >
      <option value="">{placeholder}</option>
      {[...groups].map(([g, opts]) => (
        <optgroup key={g} label={g}>
          {opts.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
              {o.isGroup ? " (group)" : ""}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

/** Text input that holds what's typed and reports a parsed value; resets when the value changes elsewhere. */
function NumberInput({
  value,
  onChange,
  parse,
  format,
  className,
  label,
  placeholder,
  disabled,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  parse: (t: string) => number | null;
  format: (v: number | null) => string;
  className: string;
  label: string;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [text, setText] = useState(format(value));
  // Follow the value only when it changes from outside (discard, a save, a reload): while
  // typing, "15" already means 15:00 and must not be rewritten before ":30" arrives.
  useEffect(() => {
    setText((t) => (parse(t) === value ? t : format(value)));
  }, [value, format, parse]);
  const parsed = parse(text);
  const bad = parsed !== null && Number.isNaN(parsed);
  return (
    <input
      value={text}
      disabled={disabled}
      onChange={(e) => {
        setText(e.target.value);
        const v = parse(e.target.value);
        if (v === null || !Number.isNaN(v)) onChange(v);
      }}
      placeholder={placeholder}
      aria-label={label}
      className={`${field} ${className} text-right tabular-nums ${bad ? "border-red-500" : ""}`}
    />
  );
}

const fmtInt = (v: number | null) => (v == null ? "" : String(v));
const parseInt_ = (t: string) => {
  const v = intOrNull(t);
  return v === null || Number.isInteger(v) ? v : NaN;
};

export function ClockEditor({
  clockId,
  initial,
  updatedAt,
  options,
  gridCells,
  timezone,
  revisions,
  readOnly = false,
}: {
  clockId: string;
  initial: ClockDraft;
  updatedAt: string;
  options: ClockCategoryOption[];
  gridCells: number;
  timezone: string;
  revisions: ClockRevisionView[];
  readOnly?: boolean;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<ClockDraft>(initial);
  const [loadedAt, setLoadedAt] = useState(updatedAt);
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const [saved, setSaved] = useState<string | null>(null);
  /** The revision loaded into the editor, until it is saved or discarded. */
  const [restoring, setRestoring] = useState<ClockRevisionView | null>(null);
  const when = (iso: string) =>
    new Date(iso).toLocaleString("en-US", { timeZone: timezone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(initial), [draft, initial]);

  // Reset to what the server now holds after a save or a reload.
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

  const nameOf = useMemo(() => new Map(options.map((o) => [o.id, o])), [options]);
  const positions = draft.positions;
  const setPositions = (next: ClockPositionDraft[]) => setDraft((d) => ({ ...d, positions: next }));
  const update = (key: string, patch: Partial<ClockPositionDraft>) =>
    setPositions(positions.map((p) => (p.key === key ? { ...p, ...patch } : p)));
  const move = (i: number, by: number) => {
    const j = i + by;
    if (j < 0 || j >= positions.length) return;
    const next = [...positions];
    [next[i], next[j]] = [next[j], next[i]];
    setPositions(next);
  };
  const insertAfter = (i: number, p: ClockPositionDraft) => {
    const next = [...positions];
    next.splice(i + 1, 0, p);
    setPositions(next);
  };
  const remove = (i: number) => {
    const gone = positions[i].key;
    // Imaging tied to this record loses its anchor rather than pointing at nothing.
    setPositions(positions.filter((_, k) => k !== i).map((p) => (p.anchorKey === gone ? { ...p, anchorKey: null } : p)));
  };

  const musicRows = positions.map((p, i) => ({ p, n: i + 1 })).filter(({ p }) => p.kind === "category");
  const counts = {
    music: positions.filter((p) => p.kind === "category" && p.fillerPriority == null).length,
    imaging: positions.filter((p) => p.kind === "sweeper").length,
    fillers: positions.filter((p) => p.fillerPriority != null).length,
  };

  async function save() {
    setPending(true);
    setProblems([]);
    setSaved(null);
    try {
      const res = await fetch(`/api/clocks/${clockId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draft, expectedUpdatedAt: loadedAt, note }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setProblems(data.problems?.length ? data.problems : [data.message ?? `Save failed (${res.status})`]);
      } else {
        setNote("");
        setSaved(
          [
            "Saved.",
            data.added ? `${data.added} added.` : null,
            data.removed ? `${data.removed} removed.` : null,
            "Logs generated from now on use it.",
          ]
            .filter(Boolean)
            .join(" ")
        );
        router.refresh();
      }
    } catch {
      setProblems(["Save failed — is the Cockpit reachable?"]);
    }
    setPending(false);
  }

  const ro = readOnly || pending;

  const restore = (r: ClockRevisionView) => {
    setDraft(draftFromSnapshot(r.snapshot, initial));
    setRestoring(r);
    setProblems([]);
    setSaved(null);
    setNote(`Restored the version of ${when(r.savedAt)}`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div className="space-y-4">
      {restoring && dirty && (
        <p className="rounded border border-sky-900 bg-sky-950/40 px-3 py-2 text-sm text-sky-100">
          Loaded the version of {when(restoring.savedAt)} into the editor. Preview it, then save to restore it, or discard
          changes to leave the clock as it is.
        </p>
      )}
      <div className="flex flex-wrap items-end gap-4">
        <label className="space-y-1 text-xs text-neutral-500">
          <span className="block">Name</span>
          <input
            value={draft.name}
            disabled={ro}
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
            className={`${field} w-48 py-1`}
          />
        </label>
        <label className="space-y-1 text-xs text-neutral-500">
          <span className="block">Length (minutes)</span>
          <NumberInput
            value={draft.lengthMinutes}
            onChange={(v) => setDraft((d) => ({ ...d, lengthMinutes: v ?? 0 }))}
            parse={parseInt_}
            format={fmtInt}
            className="w-20 py-1"
            label="Length in minutes"
            disabled={ro}
          />
        </label>
        <label className="min-w-[16rem] flex-1 space-y-1 text-xs text-neutral-500">
          <span className="block">Notes</span>
          <input
            value={draft.notes ?? ""}
            disabled={ro}
            onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))}
            className={`${field} w-full py-1`}
          />
        </label>
      </div>

      <p className="text-sm text-neutral-500">
        {positions.length} positions · {counts.music} music · {counts.imaging} imaging
        {counts.fillers ? ` · ${counts.fillers} conditional filler` : ""} ·{" "}
        {gridCells ? `played in ${gridCells} grid ${gridCells === 1 ? "hour" : "hours"} per rotation` : "not in the week grid"}
      </p>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[960px] text-left text-sm">
          <thead>
            <tr className="border-b border-neutral-800 text-xs text-neutral-400">
              <th className="sticky left-0 z-10 bg-neutral-950 py-2 pr-2 font-medium">#</th>
              <th className="py-2 pr-2 font-medium">Kind</th>
              <th className="py-2 pr-2 font-medium">Plays</th>
              <th className="py-2 pr-2 font-medium">Falls back to</th>
              <th className="py-2 pr-2 font-medium" title="Locked to this time in the hour (m:ss). Blank floats; 0:00 is top of hour.">
                Locked at
              </th>
              <th className="py-2 pr-2 font-medium" title="Conditional filler: activated, lowest first, only when the hour runs short.">
                Filler
              </th>
              <th className="py-2 pr-2 font-medium" title="Given up, lowest first, when the hour runs long.">
                Trim
              </th>
              <th className="py-2 pr-2 font-medium" title="Imaging whose copy is about a record: if that record is given up, this plays its fallback instead.">
                About record
              </th>
              <th className="py-2 pr-2 font-medium">Fixed event</th>
              {!readOnly && <th className="sticky right-0 z-10 bg-neutral-950 py-2 font-medium" />}
            </tr>
          </thead>
          <tbody>
            {positions.map((p, i) => {
              const cat = p.categoryId ? nameOf.get(p.categoryId) : null;
              const mismatch = cat && PLAYS_KIND[p.kind] && cat.kind !== PLAYS_KIND[p.kind];
              return (
                <tr key={p.key} className={`border-b border-neutral-900 ${p.fillerPriority != null ? "bg-neutral-900/40" : ""}`}>
                  <td className="sticky left-0 z-10 bg-neutral-950 py-1 pr-2 tabular-nums text-neutral-500">{i + 1}</td>
                  <td className="py-1 pr-2">
                    <select
                      value={p.kind}
                      disabled={ro}
                      onChange={(e) => {
                        const kind = e.target.value as PositionKind;
                        update(p.key, {
                          kind,
                          ...(kind === "fixed_event"
                            ? { categoryId: null, fallbackCategoryId: null, fixedDurationSeconds: p.fixedDurationSeconds ?? 0 }
                            : {}),
                        });
                      }}
                      className={field}
                      aria-label={`Kind of position ${i + 1}`}
                    >
                      {(Object.keys(KIND_LABEL) as PositionKind[]).map((k) => (
                        <option key={k} value={k}>
                          {KIND_LABEL[k]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-1 pr-2">
                    {p.kind === "fixed_event" ? (
                      <span className="text-neutral-600">—</span>
                    ) : (
                      <>
                        <CategorySelect
                          value={p.categoryId}
                          onChange={(id) => update(p.key, { categoryId: id })}
                          options={options}
                          prefer={PLAYS_KIND[p.kind]}
                          placeholder="Choose…"
                          disabled={ro}
                          label={`What position ${i + 1} plays`}
                        />
                        {mismatch && (
                          <span className="ml-1 text-xs text-amber-300" title={`A ${KIND_LABEL[p.kind].toLowerCase()} position calling a ${cat!.kind} category`}>
                            !
                          </span>
                        )}
                        {cat?.isGroup && (
                          <span className="ml-1 text-xs text-amber-300" title="A group: its songs sit in its sub-pools, so this draws nothing">
                            group
                          </span>
                        )}
                      </>
                    )}
                  </td>
                  <td className="py-1 pr-2">
                    {p.kind !== "fixed_event" && (
                      <CategorySelect
                        value={p.fallbackCategoryId}
                        onChange={(id) => update(p.key, { fallbackCategoryId: id })}
                        options={options}
                        prefer={PLAYS_KIND[p.kind]}
                        placeholder="none"
                        disabled={ro}
                        label={`Fallback for position ${i + 1}`}
                      />
                    )}
                  </td>
                  <td className="py-1 pr-2">
                    <NumberInput
                      value={p.targetOffsetSeconds}
                      onChange={(v) => update(p.key, { targetOffsetSeconds: v })}
                      parse={parseOffset}
                      format={fmtOffset}
                      className="w-16"
                      placeholder="—"
                      label={`Locked time of position ${i + 1}`}
                      disabled={ro}
                    />
                  </td>
                  <td className="py-1 pr-2">
                    <NumberInput
                      value={p.fillerPriority}
                      onChange={(v) => update(p.key, { fillerPriority: v })}
                      parse={parseInt_}
                      format={fmtInt}
                      className="w-12"
                      placeholder="—"
                      label={`Filler priority of position ${i + 1}`}
                      disabled={ro}
                    />
                  </td>
                  <td className="py-1 pr-2">
                    <NumberInput
                      value={p.trimPriority}
                      onChange={(v) => update(p.key, { trimPriority: v })}
                      parse={parseInt_}
                      format={fmtInt}
                      className="w-12"
                      placeholder="—"
                      label={`Trim priority of position ${i + 1}`}
                      disabled={ro}
                    />
                  </td>
                  <td className="py-1 pr-2">
                    {p.kind !== "fixed_event" && p.kind !== "category" && (
                      <select
                        value={p.anchorKey ?? ""}
                        disabled={ro}
                        onChange={(e) => update(p.key, { anchorKey: e.target.value || null })}
                        className={`${field} max-w-[9rem]`}
                        aria-label={`Record position ${i + 1} is about`}
                      >
                        <option value="">—</option>
                        {musicRows.map(({ p: m, n }) => (
                          <option key={m.key} value={m.key}>
                            #{n} {m.categoryId ? nameOf.get(m.categoryId)?.name ?? "?" : "?"}
                          </option>
                        ))}
                      </select>
                    )}
                  </td>
                  <td className="py-1 pr-2">
                    {p.kind === "fixed_event" && (
                      <div className="flex items-center gap-1">
                        <NumberInput
                          value={p.fixedDurationSeconds}
                          onChange={(v) => update(p.key, { fixedDurationSeconds: v })}
                          parse={parseInt_}
                          format={fmtInt}
                          className="w-14"
                          label={`Length in seconds of position ${i + 1}`}
                          disabled={ro}
                        />
                        <span className="text-xs text-neutral-500">s</span>
                        <input
                          value={p.fixedRef ?? ""}
                          disabled={ro}
                          onChange={(e) => update(p.key, { fixedRef: e.target.value || null })}
                          placeholder="what it is"
                          aria-label={`What fixed event ${i + 1} is`}
                          className={`${field} w-28`}
                        />
                      </div>
                    )}
                  </td>
                  {!readOnly && (
                    <td className="sticky right-0 z-10 whitespace-nowrap bg-neutral-950 py-1 pl-2 text-xs">
                      <button onClick={() => move(i, -1)} disabled={ro || i === 0} className="px-1 text-neutral-400 hover:text-neutral-100 disabled:opacity-30" aria-label={`Move position ${i + 1} up`}>
                        ↑
                      </button>
                      <button onClick={() => move(i, 1)} disabled={ro || i === positions.length - 1} className="px-1 text-neutral-400 hover:text-neutral-100 disabled:opacity-30" aria-label={`Move position ${i + 1} down`}>
                        ↓
                      </button>
                      <button onClick={() => insertAfter(i, blankPosition(p.kind))} disabled={ro} className="px-1 text-neutral-400 hover:text-neutral-100" title="Insert a position below">
                        + below
                      </button>
                      <button
                        onClick={() => insertAfter(i, { ...p, id: null, key: newKey(), targetOffsetSeconds: null })}
                        disabled={ro}
                        className="px-1 text-neutral-400 hover:text-neutral-100"
                        title="Duplicate this position below"
                      >
                        copy
                      </button>
                      <button onClick={() => remove(i)} disabled={ro} className="px-1 text-red-400 hover:text-red-300" aria-label={`Remove position ${i + 1}`}>
                        ✕
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {!readOnly && (
        <div className="space-y-3">
          <button
            onClick={() => setPositions([...positions, blankPosition()])}
            disabled={ro}
            className="rounded border border-neutral-700 px-3 py-1 text-sm text-neutral-200 hover:bg-neutral-900"
          >
            Add a position at the end
          </button>
          <ClockPreviewPanel key={loadedAt} clockId={clockId} draft={draft} dirty={dirty} timezone={timezone} />
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
              className={`${field} w-full py-1 sm:w-96`}
            />
            <button
              onClick={save}
              disabled={ro || !dirty}
              className="rounded bg-blue-700 px-4 py-1 text-sm font-medium text-white hover:bg-blue-600 disabled:opacity-50"
            >
              {pending ? "Saving…" : "Save clock"}
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

      <section className="space-y-2 pt-4">
        <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500">History</h2>
        {revisions.length === 0 ? (
          <p className="text-sm text-neutral-500">
            Not edited in Rotavox yet. The first save also keeps the clock as it stands now.
          </p>
        ) : (
          <ul className="text-sm">
            {revisions.map((r, i) => {
              const asDraft = draftFromSnapshot(r.snapshot, initial);
              const diff = describeDifference(asDraft, initial);
              return (
                <li key={r.id} className="flex flex-wrap items-baseline gap-x-3 border-b border-neutral-900 py-1.5">
                  <span className="w-32 shrink-0 tabular-nums text-neutral-400">{when(r.savedAt)}</span>
                  <span className="text-neutral-300">{r.savedByName ?? (i === revisions.length - 1 ? "Before Rotavox" : "—")}</span>
                  <span className="text-neutral-500">{r.note ?? ""}</span>
                  <span className={`text-xs ${diff === "same as now" ? "text-emerald-300" : "text-neutral-500"}`}>
                    {diff === "same as now" ? (i === 0 ? "current" : diff) : diff}
                  </span>
                  {!readOnly && diff !== "same as now" && (
                    <button
                      onClick={() => restore(r)}
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
