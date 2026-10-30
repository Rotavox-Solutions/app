"use client";

import { useState } from "react";
import type { ClockDraft } from "@rotavox/schema";
import type { ClockPreview, PreviewHour, PreviewRun } from "@/lib/clock-preview";

const TOLERANCE = { min: 57, max: 63 };
const HOUR_CHOICES = [3, 6, 12, 24];

const fmtMin = (m: number) => m.toFixed(1);
const fmtLen = (ms: number) => {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
const off = (m: number) => m < TOLERANCE.min || m > TOLERANCE.max;

function Minutes({ m }: { m: number | undefined }) {
  if (m == null) return <span className="text-neutral-600">—</span>;
  return <span className={off(m) ? "text-amber-300" : ""}>{fmtMin(m)}</span>;
}

function Summary({ label, run }: { label: string; run: PreviewRun }) {
  return (
    <div className="rounded border border-neutral-800 px-4 py-3">
      <div className="text-xs text-neutral-500">{label}</div>
      <div className="mt-1 text-sm tabular-nums">
        <Minutes m={run.min} /> – <Minutes m={run.max} /> min
        <span className="text-neutral-500"> · median {fmtMin(run.median)}</span>
      </div>
      <div className="mt-0.5 text-xs text-neutral-500">
        {run.outOfTolerance ? (
          <span className="text-amber-300">
            {run.outOfTolerance} {run.outOfTolerance === 1 ? "hour" : "hours"} outside {TOLERANCE.min}–{TOLERANCE.max} min
          </span>
        ) : (
          `every hour within ${TOLERANCE.min}–${TOLERANCE.max} min`
        )}
        {" · "}filler {run.stats.fillerActivated} · given up {run.stats.sacrificed} · unfillable {run.stats.unfillable}
      </div>
    </div>
  );
}

function RunningOrder({ hour }: { hour: PreviewHour }) {
  return (
    <table className="w-full text-xs">
      <tbody>
        {hour.running.map((r, i) => (
          <tr key={i} className={`border-b border-neutral-900 ${r.filler ? "text-neutral-400" : ""}`}>
            <td className="w-8 py-0.5 tabular-nums text-neutral-500">{r.position ?? "—"}</td>
            <td className="w-32 py-0.5 text-neutral-400">
              {r.category ?? r.elementType}
              {r.filler && " (filler)"}
            </td>
            <td className="py-0.5">
              {r.artist || r.title ? (
                <>
                  {r.artist ?? "—"} · {r.title ?? "—"}
                </>
              ) : (
                <span className="text-amber-300">{r.elementType === "fixed_event" ? "fixed event" : "nothing to play"}</span>
              )}
              {r.violations > 0 && (
                <span className="ml-2 text-amber-300" title="Broke a separation or rotation rule to fill">
                  {r.violations} rule {r.violations === 1 ? "break" : "breaks"}
                </span>
              )}
            </td>
            <td className="w-12 py-0.5 text-right tabular-nums text-neutral-400">{fmtLen(r.durationMs)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * Runs the next hours with this clock, saved and as edited, against live songs and play
 * history, so the effect of an edit is seen before it's saved. Nothing is written.
 */
export function ClockPreviewPanel({
  clockId,
  draft,
  dirty,
  timezone,
}: {
  clockId: string;
  draft: ClockDraft;
  dirty: boolean;
  timezone: string;
}) {
  const [hours, setHours] = useState(6);
  const [pending, setPending] = useState(false);
  const [preview, setPreview] = useState<ClockPreview | null>(null);
  const [previewedDraft, setPreviewedDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/clocks/${clockId}/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draft, hours }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setError(data.problems?.length ? `Fix the clock first: ${data.problems[0]}` : data.message ?? `Preview failed (${res.status})`);
      else {
        setPreview(data);
        setPreviewedDraft(JSON.stringify(draft));
      }
    } catch {
      setError("Preview failed — is the Cockpit reachable?");
    }
    setPending(false);
  }

  const stale = preview && previewedDraft !== JSON.stringify(draft);
  const hourLabel = (iso: string) =>
    new Date(iso).toLocaleString("en-US", { timeZone: timezone, weekday: "short", hour: "numeric" });
  const savedByHour = new Map((preview?.saved.hours ?? []).map((h) => [h.hour, h]));

  return (
    <section className="space-y-3 rounded border border-neutral-800 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500">Preview</h2>
        <select
          value={hours}
          onChange={(e) => setHours(Number(e.target.value))}
          className="rounded border border-neutral-700 bg-neutral-900 px-2 py-0.5 text-sm text-neutral-100"
          aria-label="Hours to preview"
        >
          {HOUR_CHOICES.map((h) => (
            <option key={h} value={h}>
              next {h} hours
            </option>
          ))}
        </select>
        <button
          onClick={run}
          disabled={pending}
          className="rounded border border-neutral-700 px-3 py-1 text-sm text-neutral-200 hover:bg-neutral-900 disabled:opacity-50"
        >
          {pending ? "Generating…" : dirty ? "Preview this draft" : "Preview this clock"}
        </button>
        <span className="text-xs text-neutral-500">
          Generates with live songs and play history, as if this clock played every hour. Nothing is saved.
        </span>
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}
      {preview && (
        <div className={`space-y-3 ${stale ? "opacity-60" : ""}`}>
          {stale && <p className="text-xs text-amber-300">The clock has changed since this preview. Run it again.</p>}
          <div className="grid gap-3 md:grid-cols-2">
            <Summary label="Saved clock" run={preview.saved} />
            <Summary label={dirty || stale ? "This draft" : "This draft (same as saved)"} run={preview.draft} />
          </div>
          {preview.cueFidelity < 1 && (
            <p className="text-xs text-neutral-500">
              {(100 - preview.cueFidelity * 100).toFixed(1)}% of songs have no segue point in RadioDJ, so lengths are
              approximate.
            </p>
          )}
          <div className="space-y-1">
            {preview.draft.hours.map((h) => (
              <details key={h.hour} className="rounded border border-neutral-900">
                <summary className="flex cursor-pointer flex-wrap items-center gap-x-4 px-3 py-1.5 text-sm">
                  <span className="w-24 text-neutral-300">{hourLabel(h.hour)}</span>
                  <span className="tabular-nums">
                    <Minutes m={h.minutes} /> min
                    <span className="text-neutral-500">
                      {" "}
                      (saved <Minutes m={savedByHour.get(h.hour)?.minutes} />)
                    </span>
                  </span>
                  <span className="text-xs text-neutral-500">
                    {h.items} items{h.filler ? ` · ${h.filler} filler` : ""}
                    {h.unfilled ? <span className="text-amber-300"> · {h.unfilled} unfilled</span> : null}
                  </span>
                </summary>
                <div className="px-3 pb-2">
                  <RunningOrder hour={h} />
                </div>
              </details>
            ))}
          </div>
          {preview.draft.warnings.length > 0 && (
            <details className="text-xs text-neutral-400">
              <summary className="cursor-pointer text-amber-300">
                {preview.draft.warnings.length} generator {preview.draft.warnings.length === 1 ? "warning" : "warnings"}
              </summary>
              <ul className="mt-1 space-y-0.5">
                {preview.draft.warnings.slice(0, 30).map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </section>
  );
}
