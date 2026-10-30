"use client";

import { useState } from "react";
import type { ImportMapping, PlanRow } from "@rotavox/schema";

const FIELDS: { key: keyof ImportMapping; label: string; help: string }[] = [
  { key: "title", label: "Title", help: "Needed, unless the file path is given (the file name is used)" },
  { key: "artist", label: "Artist", help: "" },
  { key: "album", label: "Album", help: "" },
  { key: "duration", label: "Length", help: "m:ss, h:mm:ss, seconds or milliseconds" },
  { key: "path", label: "File path", help: "Where the playout system finds the file" },
  { key: "id", label: "Song number", help: "The playout system's own ID, if it has one; matches songs on re-import" },
  { key: "pool", label: "Pool", help: "New songs go into the Rotavox pool of this name; others wait in the Inbox" },
  { key: "type", label: "Type", help: "music, jingle, sweeper or voiceover" },
  { key: "enabled", label: "Enabled", help: "yes/no; songs default to enabled" },
];

const ACTION: Record<string, { label: string; tone: string }> = {
  create: { label: "new", tone: "text-emerald-300" },
  update: { label: "update", tone: "text-sky-300" },
  unchanged: { label: "same", tone: "text-neutral-500" },
  skip: { label: "skip", tone: "text-amber-300" },
};

interface Preview {
  header: string[];
  mapping: ImportMapping;
  counts: Record<string, number>;
  notInFile: number;
  matchBy: string;
  problems: string[];
  rows: PlanRow[];
  hasRunner: boolean;
  unknownPools: { name: string; songs: number }[];
}

const fmtLength = (ms: number | null) => {
  if (ms == null) return "—";
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

async function post(url: string, body: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

/**
 * Upload a library exported from the station's playout system: choose the file, check
 * which column is which, see what it would do, then import.
 */
export function LibraryImport() {
  const [fileName, setFileName] = useState<string | null>(null);
  const [csv, setCsv] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ created: number; updated: number; placed: number; toInbox: number } | null>(null);

  async function load(text: string, mapping?: ImportMapping) {
    setPending(true);
    setError(null);
    try {
      const { ok, status, data } = await post("/api/library/import/preview", { csv: text, mapping });
      if (!ok) {
        setPreview(null);
        setError(data.message ?? `Couldn't read the file (${status})`);
      } else setPreview(data);
    } catch {
      setError("Couldn't reach the Cockpit.");
    }
    setPending(false);
  }

  async function run() {
    if (!csv || !preview) return;
    setPending(true);
    setError(null);
    try {
      const { ok, status, data } = await post("/api/library/import", { csv, mapping: preview.mapping });
      if (!ok) setError(data.message ?? `Import failed (${status})`);
      else setDone(data);
    } catch {
      setError("Couldn't reach the Cockpit.");
    }
    setPending(false);
  }

  if (done) {
    return (
      <div className="space-y-2 rounded border border-emerald-900/60 bg-emerald-950/30 p-4 text-sm">
        <p className="text-emerald-200">
          Imported {fileName}: {done.created} new {done.created === 1 ? "song" : "songs"}, {done.updated} updated.
        </p>
        <p className="text-neutral-300">
          {done.placed} new {done.placed === 1 ? "song went" : "songs went"} into {done.placed === 1 ? "its" : "their"} pool
          {done.toInbox ? `; ${done.toInbox} wait in the Inbox for one` : ""}.
        </p>
        <p className="flex gap-4">
          <a href="/music/library" className="text-neutral-200 hover:underline">
            Library →
          </a>
          {done.toInbox > 0 && (
            <a href="/music/inbox" className="text-neutral-200 hover:underline">
              Inbox →
            </a>
          )}
        </p>
      </div>
    );
  }

  const changing = preview ? preview.counts.create + preview.counts.update : 0;
  const blocked = !preview || preview.problems.length > 0 || preview.hasRunner || changing === 0;

  return (
    <div className="space-y-5">
      <label className="block space-y-1 text-sm">
        <span className="text-neutral-400">Library file (CSV, from your playout system)</span>
        <input
          type="file"
          accept=".csv,.txt,text/csv"
          disabled={pending}
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            setFileName(file.name);
            const text = await file.text();
            setCsv(text);
            await load(text);
          }}
          className="block text-sm text-neutral-300 file:mr-3 file:rounded file:border file:border-neutral-700 file:bg-neutral-900 file:px-3 file:py-1 file:text-neutral-200"
        />
      </label>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {preview && (
        <>
          {preview.hasRunner && (
            <p className="rounded border border-amber-900/60 bg-amber-950/30 p-3 text-sm text-amber-200">
              This station&apos;s library comes from RadioDJ through the Runner, so it can&apos;t be imported from a file.
            </p>
          )}

          <section className="space-y-2">
            <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500">Which column is which</h2>
            <div className="grid gap-2 sm:grid-cols-2">
              {FIELDS.map((f) => (
                <label key={f.key} className="flex items-center gap-2 text-sm">
                  <span className="w-28 shrink-0 text-neutral-400">{f.label}</span>
                  <select
                    value={preview.mapping[f.key] ?? ""}
                    disabled={pending}
                    onChange={(e) => {
                      const next = { ...preview.mapping };
                      if (e.target.value === "") delete next[f.key];
                      else next[f.key] = Number(e.target.value);
                      if (csv) load(csv, next);
                    }}
                    className="min-w-0 flex-1 rounded border border-neutral-700 bg-neutral-900 px-2 py-0.5 text-sm text-neutral-100"
                    title={f.help}
                  >
                    <option value="">—</option>
                    {preview.header.map((h, i) => (
                      <option key={i} value={i}>
                        {h || `Column ${i + 1}`}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <p className="text-xs text-neutral-500">
              Songs already in Rotavox are matched by {preview.matchBy}, falling back to artist and title.
            </p>
          </section>

          {preview.problems.length > 0 && (
            <ul className="space-y-0.5 rounded border border-red-900/60 bg-red-950/30 p-3 text-sm text-red-300">
              {preview.problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}

          <section className="space-y-2">
            <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500">What it would do</h2>
            <p className="text-sm text-neutral-300">
              {preview.counts.create} new · {preview.counts.update} updated · {preview.counts.unchanged} the same
              {preview.counts.skip ? ` · ${preview.counts.skip} skipped` : ""}
            </p>
            {preview.unknownPools.length > 0 && (
              <p className="text-xs text-amber-300">
                No pool here is called{" "}
                {preview.unknownPools.map((p, i) => (
                  <span key={p.name}>
                    {i > 0 ? ", " : ""}&ldquo;{p.name}&rdquo; ({p.songs})
                  </span>
                ))}
                : those new songs go to the Inbox. Make the pool under Categories first to place them on import.
              </p>
            )}
            {preview.notInFile > 0 && (
              <p className="text-xs text-neutral-500">
                {preview.notInFile} {preview.notInFile === 1 ? "song" : "songs"} in Rotavox {preview.notInFile === 1 ? "isn't" : "aren't"} in
                this file. Nothing is removed; bench or retire them in the Library if they&apos;ve gone.
              </p>
            )}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead>
                  <tr className="border-b border-neutral-800 text-neutral-400">
                    <th className="py-1.5 font-medium">Line</th>
                    <th className="py-1.5 font-medium" />
                    <th className="py-1.5 font-medium">Artist · Title</th>
                    <th className="py-1.5 text-right font-medium">Length</th>
                    <th className="py-1.5 pl-4 font-medium">Pool</th>
                    <th className="py-1.5 font-medium">Note</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((r) => (
                    <tr key={r.line} className="border-b border-neutral-900">
                      <td className="py-1 tabular-nums text-neutral-500">{r.line}</td>
                      <td className={`py-1 text-xs uppercase tracking-wide ${ACTION[r.action].tone}`}>{ACTION[r.action].label}</td>
                      <td className="py-1">
                        {r.song.artist ?? "—"} · {r.song.title ?? "—"}
                      </td>
                      <td className="py-1 text-right tabular-nums text-neutral-400">{fmtLength(r.song.durationMs)}</td>
                      <td className="py-1 pl-4 text-neutral-400">{r.song.pool ?? ""}</td>
                      <td className="py-1 text-xs text-neutral-500">{r.reason ?? (r.changes.length ? `changes ${r.changes.join(", ")}` : "")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {preview.rows.length < Object.values(preview.counts).reduce((a, b) => a + b, 0) && (
              <p className="text-xs text-neutral-500">Showing the first {preview.rows.length} rows, changes first.</p>
            )}
          </section>

          <div className="flex items-center gap-3 border-t border-neutral-800 pt-3">
            <button
              onClick={run}
              disabled={pending || blocked}
              className="rounded bg-blue-700 px-4 py-1 text-sm font-medium text-white hover:bg-blue-600 disabled:opacity-50"
            >
              {pending ? "Working…" : `Import ${changing} ${changing === 1 ? "song" : "songs"}`}
            </button>
            <span className="text-xs text-neutral-500">
              Updates the artist, title and the other columns chosen above. Pools and lifecycle of songs already here are
              never changed by an import.
            </span>
          </div>
        </>
      )}
    </div>
  );
}
