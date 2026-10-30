"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const field = "rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm text-neutral-100 disabled:opacity-50";

async function put(url: string, body: unknown): Promise<string | null> {
  try {
    const res = await fetch(url, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (res.ok) return null;
    const data = await res.json().catch(() => ({}));
    return data.message ?? data.error ?? `Request failed (${res.status})`;
  } catch {
    return "Request failed — is the Cockpit reachable?";
  }
}

export function StationNameForm({ name, readOnly }: { name: string; readOnly: boolean }) {
  const router = useRouter();
  const [value, setValue] = useState(name);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (readOnly) return <span>{name}</span>;
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setPending(true);
        setError(null);
        const err = await put("/api/station/settings", { name: value });
        setPending(false);
        if (err) setError(err);
        else router.refresh();
      }}
      className="flex flex-wrap items-center gap-2"
    >
      <input value={value} onChange={(e) => setValue(e.target.value)} disabled={pending} className={`${field} w-64`} aria-label="Station name" />
      {value.trim() !== name && (
        <button disabled={pending} className="rounded border border-neutral-700 px-3 py-1 text-sm text-neutral-200 hover:bg-neutral-900">
          Save
        </button>
      )}
      {error && <span className="text-sm text-red-400">{error}</span>}
    </form>
  );
}

/**
 * How many weeks the grid repeats over and which of them is airing. Shows what a change
 * does to the grid before it's saved.
 */
export function RotationForm({
  cycleWeeks,
  airingWeek,
  hoursByWeek,
  gridUpdatedAt,
  maxWeeks,
  readOnly,
}: {
  cycleWeeks: number;
  /** 1-based. */
  airingWeek: number;
  /** Grid hours set in each week, index 0 = week 1. */
  hoursByWeek: number[];
  gridUpdatedAt: string;
  maxWeeks: number;
  readOnly: boolean;
}) {
  const router = useRouter();
  const [weeks, setWeeks] = useState(cycleWeeks);
  const [airing, setAiring] = useState(airingWeek);
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changed = weeks !== cycleWeeks || (weeks > 1 && airing !== airingWeek);

  const effects: string[] = [];
  if (weeks > cycleWeeks) {
    effects.push(
      `Weeks ${cycleWeeks + 1}${weeks > cycleWeeks + 1 ? `–${weeks}` : ""} start as copies of week 1 (${hoursByWeek[0] ?? 0} hours each). Edit them on the Week grid.`
    );
  }
  if (weeks < cycleWeeks) {
    const lost = hoursByWeek.slice(weeks).reduce((a, b) => a + b, 0);
    effects.push(`Week${cycleWeeks - weeks > 1 ? `s ${weeks + 1}–${cycleWeeks}` : ` ${cycleWeeks}`} and their ${lost} grid hours are removed. History keeps them.`);
  }
  if (weeks > 1 && airing !== Math.min(airingWeek, weeks)) {
    effects.push(`From now, week ${airing} airs this week, and the rest follow in order.`);
  }

  if (readOnly) {
    return (
      <p className="text-sm">
        {cycleWeeks === 1 ? "One week, repeating." : `${cycleWeeks} weeks; week ${airingWeek} is airing.`}
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label className="flex items-center gap-2">
          The grid repeats every
          <select
            value={weeks}
            onChange={(e) => {
              const w = Number(e.target.value);
              setWeeks(w);
              setAiring((a) => Math.min(a, w));
            }}
            disabled={pending}
            className={field}
          >
            {Array.from({ length: maxWeeks }, (_, i) => i + 1).map((w) => (
              <option key={w} value={w}>
                {w} {w === 1 ? "week" : "weeks"}
              </option>
            ))}
          </select>
        </label>
        {weeks > 1 && (
          <label className="flex items-center gap-2">
            and this week is
            <select value={airing} onChange={(e) => setAiring(Number(e.target.value))} disabled={pending} className={field}>
              {Array.from({ length: weeks }, (_, i) => i + 1).map((w) => (
                <option key={w} value={w}>
                  week {w}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {changed && effects.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-5 text-sm text-amber-200">
          {effects.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
      {changed && (
        <div className="flex flex-wrap items-center gap-3">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            disabled={pending}
            placeholder="Why (optional)"
            className={`${field} w-full sm:w-80`}
          />
          <button
            onClick={async () => {
              setPending(true);
              setError(null);
              const err = await put("/api/station/rotation", {
                cycleWeeks: weeks,
                airingWeek: airing,
                expectedUpdatedAt: gridUpdatedAt,
                note,
              });
              setPending(false);
              if (err) setError(err);
              else {
                setNote("");
                router.refresh();
              }
            }}
            disabled={pending}
            className="rounded bg-blue-700 px-4 py-1 text-sm font-medium text-white hover:bg-blue-600 disabled:opacity-50"
          >
            {pending ? "Saving…" : "Change the rotation"}
          </button>
          <button
            onClick={() => {
              setWeeks(cycleWeeks);
              setAiring(airingWeek);
            }}
            disabled={pending}
            className="text-sm text-neutral-400 hover:text-neutral-200"
          >
            Cancel
          </button>
        </div>
      )}
      {error && <p className="text-sm text-red-400">{error}</p>}
    </div>
  );
}
