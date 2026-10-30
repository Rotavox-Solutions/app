"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { GridCell, GridSnapshot } from "@rotavox/schema";

/** Monday first, as a programming week reads; the engine's 0 is Sunday. */
const DAYS: { dow: number; label: string }[] = [
  { dow: 1, label: "Mon" },
  { dow: 2, label: "Tue" },
  { dow: 3, label: "Wed" },
  { dow: 4, label: "Thu" },
  { dow: 5, label: "Fri" },
  { dow: 6, label: "Sat" },
  { dow: 0, label: "Sun" },
];
const HOURS = Array.from({ length: 24 }, (_, h) => h);
/** Distinct hues for up to a couple of dozen clocks; repeats past that, with the name still shown. */
const HUES = [210, 30, 140, 280, 0, 175, 50, 320, 100, 245, 15, 190, 65, 300, 120, 350, 160, 230, 85, 265];

const key = (week: number, dow: number, hour: number) => `${week}|${dow}|${hour}`;
const hourLabel = (h: number) => (h === 0 ? "12a" : h < 12 ? `${h}a` : h === 12 ? "12p" : `${h - 12}p`);

export interface GridRevisionView {
  id: string;
  savedAt: string;
  note: string | null;
  savedByName: string | null;
  snapshot: GridSnapshot;
}

type CellMap = Record<string, string>;

function toMap(cells: GridCell[]): CellMap {
  return Object.fromEntries(cells.map((c) => [key(c.weekInCycle, c.dayOfWeek, c.hour), c.clockId]));
}

function toCells(map: CellMap): GridCell[] {
  return Object.entries(map).map(([k, clockId]) => {
    const [weekInCycle, dayOfWeek, hour] = k.split("|").map(Number);
    return { weekInCycle, dayOfWeek, hour, clockId };
  });
}

function sameMap(a: CellMap, b: CellMap) {
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => a[k] === b[k]);
}

export function GridEditor({
  initial,
  updatedAt,
  cycleWeeks,
  currentWeek,
  clocks,
  revisions,
  timezone,
  readOnly = false,
}: {
  initial: GridCell[];
  updatedAt: string;
  cycleWeeks: number;
  /** The rotation week airing now (0-based). */
  currentWeek: number;
  clocks: { id: string; name: string }[];
  revisions: GridRevisionView[];
  timezone: string;
  readOnly?: boolean;
}) {
  const router = useRouter();
  const initialMap = useMemo(() => toMap(initial), [initial]);
  const [map, setMap] = useState<CellMap>(initialMap);
  const [loadedAt, setLoadedAt] = useState(updatedAt);
  const [week, setWeek] = useState(currentWeek);
  const [brush, setBrush] = useState<string>(clocks[0]?.id ?? "");
  const [painting, setPainting] = useState(false);
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const [saved, setSaved] = useState<string | null>(null);
  const [restoring, setRestoring] = useState<GridRevisionView | null>(null);
  const dirty = !sameMap(map, initialMap);

  useEffect(() => {
    setMap(initialMap);
    setLoadedAt(updatedAt);
    setRestoring(null);
  }, [initialMap, updatedAt]);

  useEffect(() => {
    const stop = () => setPainting(false);
    window.addEventListener("pointerup", stop);
    return () => window.removeEventListener("pointerup", stop);
  }, []);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const clockById = useMemo(() => new Map(clocks.map((c, i) => [c.id, { ...c, hue: HUES[i % HUES.length] }])), [clocks]);
  const when = (iso: string) =>
    new Date(iso).toLocaleString("en-US", { timeZone: timezone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

  const paint = (k: string) => {
    if (readOnly) return;
    setMap((m) => {
      if ((m[k] ?? "") === brush) return m;
      const next = { ...m };
      if (brush) next[k] = brush;
      else delete next[k];
      return next;
    });
  };

  const copyWeek = (from: number, to: number) =>
    setMap((m) => {
      const next: CellMap = Object.fromEntries(Object.entries(m).filter(([k]) => !k.startsWith(`${to}|`)));
      for (const [k, v] of Object.entries(m)) {
        if (k.startsWith(`${from}|`)) next[`${to}|${k.slice(k.indexOf("|") + 1)}`] = v;
      }
      return next;
    });

  // Hours per clock across the whole cycle, and the hours nothing plays.
  const usage = useMemo(() => {
    const byClock = new Map<string, number>();
    for (const v of Object.values(map)) byClock.set(v, (byClock.get(v) ?? 0) + 1);
    return byClock;
  }, [map]);
  const totalHours = cycleWeeks * 7 * 24;
  const empty = totalHours - Object.keys(map).length;
  const emptyThisWeek = DAYS.reduce((n, d) => n + HOURS.filter((h) => !map[key(week, d.dow, h)]).length, 0);

  async function save() {
    setPending(true);
    setProblems([]);
    setSaved(null);
    try {
      const res = await fetch("/api/grid", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cells: toCells(map), expectedUpdatedAt: loadedAt, note }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setProblems(data.problems?.length ? data.problems : [data.message ?? `Save failed (${res.status})`]);
      else {
        setNote("");
        setSaved(`Saved.${data.empty ? ` ${data.empty} hours have no clock.` : ""} Logs generated from now on use it.`);
        router.refresh();
      }
    } catch {
      setProblems(["Save failed — is the Cockpit reachable?"]);
    }
    setPending(false);
  }

  const restore = (r: GridRevisionView) => {
    // Cells past this station's current cycle length can't be shown or saved; drop them.
    setMap(toMap(r.snapshot.cells.filter((c) => c.weekInCycle < cycleWeeks)));
    setRestoring(r);
    setProblems([]);
    setSaved(null);
    setNote(`Restored the grid of ${when(r.savedAt)}`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const ro = readOnly || pending;

  return (
    <div className="space-y-4">
      {restoring && dirty && (
        <p className="rounded border border-sky-900 bg-sky-950/40 px-3 py-2 text-sm text-sky-100">
          Loaded the grid of {when(restoring.savedAt)} into the editor. Save to restore it, or discard changes to leave the
          grid as it is.
        </p>
      )}

      {cycleWeeks > 1 && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {Array.from({ length: cycleWeeks }, (_, w) => (
            <button
              key={w}
              onClick={() => setWeek(w)}
              className={`rounded px-3 py-1 ${w === week ? "bg-neutral-800 text-neutral-100" : "text-neutral-400 hover:bg-neutral-900"}`}
            >
              Week {w + 1}
              {w === currentWeek && <span className="ml-1 text-xs text-emerald-300">airing</span>}
            </button>
          ))}
          {!readOnly &&
            Array.from({ length: cycleWeeks }, (_, w) => w)
              .filter((w) => w !== week)
              .map((w) => (
                <button key={w} onClick={() => copyWeek(week, w)} disabled={ro} className="ml-2 text-xs text-neutral-400 hover:text-neutral-200">
                  Copy week {week + 1} onto week {w + 1}
                </button>
              ))}
        </div>
      )}

      {!readOnly && (
        <div className="flex flex-wrap items-center gap-1.5 text-sm">
          <span className="mr-1 text-xs text-neutral-500">Paint with</span>
          {clocks.map((c) => {
            const hue = clockById.get(c.id)!.hue;
            return (
              <button
                key={c.id}
                onClick={() => setBrush(c.id)}
                className={`rounded px-2 py-0.5 text-xs font-medium ${brush === c.id ? "ring-2 ring-white" : ""}`}
                style={{ background: `hsl(${hue} 45% 28%)`, color: `hsl(${hue} 80% 88%)` }}
              >
                {c.name}
              </button>
            );
          })}
          <button
            onClick={() => setBrush("")}
            className={`rounded border border-dashed border-neutral-600 px-2 py-0.5 text-xs text-neutral-400 ${brush === "" ? "ring-2 ring-white" : ""}`}
          >
            No clock
          </button>
          <span className="ml-2 text-xs text-neutral-500">Click an hour, or drag across hours.</span>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="select-none border-collapse text-xs" onPointerLeave={() => setPainting(false)}>
          <thead>
            <tr>
              <th className="w-10" />
              {DAYS.map((d) => (
                <th key={d.dow} className="w-24 pb-1 font-medium text-neutral-400">
                  {d.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {HOURS.map((h) => (
              <tr key={h}>
                <td className="pr-2 text-right tabular-nums text-neutral-500">{hourLabel(h)}</td>
                {DAYS.map((d) => {
                  const k = key(week, d.dow, h);
                  const c = map[k] ? clockById.get(map[k]) : undefined;
                  const changed = (map[k] ?? "") !== (initialMap[k] ?? "");
                  return (
                    <td
                      key={d.dow}
                      onPointerDown={(e) => {
                        e.preventDefault();
                        setPainting(true);
                        paint(k);
                      }}
                      onPointerEnter={() => painting && paint(k)}
                      className={`h-6 border border-neutral-950 px-1.5 ${readOnly ? "" : "cursor-pointer"} ${changed ? "outline outline-1 -outline-offset-2 outline-white/70" : ""}`}
                      style={
                        c
                          ? { background: `hsl(${c.hue} 45% 24%)`, color: `hsl(${c.hue} 80% 85%)` }
                          : { background: "repeating-linear-gradient(45deg,#262626 0 4px,#171717 4px 8px)" }
                      }
                      title={`${d.label} ${hourLabel(h)}: ${c?.name ?? (map[k] ? "a clock that no longer exists" : "no clock — this hour gets no log")}`}
                    >
                      <span className="block truncate">{c?.name ?? (map[k] ? "?" : "")}</span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-400">
        {clocks
          .filter((c) => usage.get(c.id))
          .map((c) => (
            <span key={c.id}>
              {c.name} <span className="tabular-nums text-neutral-500">{usage.get(c.id)}h</span>
            </span>
          ))}
        {empty > 0 && (
          <span className="text-amber-300">
            {empty} {empty === 1 ? "hour has" : "hours have"} no clock across the rotation
            {cycleWeeks > 1 ? ` (${emptyThisWeek} in week ${week + 1})` : ""}: they get no log, and RadioDJ&apos;s AutoDJ
            fills them
          </span>
        )}
      </div>

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
              {pending ? "Saving…" : "Save grid"}
            </button>
            {dirty && (
              <button
                onClick={() => {
                  setMap(initialMap);
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
              {dirty ? "Unsaved changes, outlined." : "No changes."} Saving changes only logs generated afterwards.
            </span>
          </div>
        </div>
      )}

      <section className="space-y-2 pt-4">
        <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500">History</h2>
        {revisions.length === 0 ? (
          <p className="text-sm text-neutral-500">Not edited in Rotavox yet. The first save also keeps the grid as it stands now.</p>
        ) : (
          <ul className="text-sm">
            {revisions.map((r, i) => {
              const m = toMap(r.snapshot.cells.filter((c) => c.weekInCycle < cycleWeeks));
              const differ = new Set([...Object.keys(m), ...Object.keys(initialMap)].filter((k) => m[k] !== initialMap[k])).size;
              return (
                <li key={r.id} className="flex flex-wrap items-baseline gap-x-3 border-b border-neutral-900 py-1.5">
                  <span className="w-32 shrink-0 tabular-nums text-neutral-400">{when(r.savedAt)}</span>
                  <span className="text-neutral-300">{r.savedByName ?? (i === revisions.length - 1 ? "Before Rotavox" : "—")}</span>
                  <span className="text-neutral-500">{r.note ?? ""}</span>
                  <span className={`text-xs ${differ ? "text-neutral-500" : "text-emerald-300"}`}>
                    {differ ? `${differ} ${differ === 1 ? "hour differs" : "hours differ"}` : i === 0 ? "current" : "same as now"}
                  </span>
                  {!readOnly && differ > 0 && (
                    <button onClick={() => restore(r)} disabled={pending} className="text-xs text-sky-300 hover:underline disabled:opacity-50">
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
