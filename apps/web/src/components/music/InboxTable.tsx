"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { CategoryOption, InboxSong } from "@/lib/music-edits";
import { CategoryPicker } from "./CategoryPicker";
import { stage, unstageSongs } from "./changes-client";
import { fmtDuration } from "./format";

const SONG_TYPE: Record<number, string> = { 0: "music", 1: "jingle", 2: "sweeper", 3: "voiceover" };

/** readOnly: for a Viewer — the list, the filter and the suggested filing, with no staging controls. */
export function InboxTable({
  songs,
  options,
  readOnly = false,
}: {
  songs: InboxSong[];
  options: CategoryOption[];
  readOnly?: boolean;
}) {
  const router = useRouter();
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkTarget, setBulkTarget] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return songs;
    return songs.filter((s) =>
      [s.artist, s.title, s.album, s.rdjSubcategoryId != null ? `subcat ${s.rdjSubcategoryId}` : ""]
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [songs, filter]);

  async function run(op: () => Promise<string | null>) {
    setPending(true);
    setError(null);
    const err = await op();
    setPending(false);
    if (err) setError(err);
    else router.refresh();
  }

  const place = (songIds: string[], categoryId: string) =>
    run(() =>
      categoryId ? stage(songIds.map((songId) => ({ songId, state: "active", categoryId }))) : unstageSongs(songIds),
    );

  const allVisibleSelected = visible.length > 0 && visible.every((s) => selected.has(s.id));
  const toggleAll = () => setSelected(allVisibleSelected ? new Set() : new Set(visible.map((s) => s.id)));
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const stagedCount = songs.filter((s) => s.isStaged).length;
  const nameOf = new Map(options.map((o) => [o.id, o.name]));
  const suggestionLabel = (s: InboxSong) =>
    !s.suggested
      ? null
      : s.suggested.state === "active"
        ? (nameOf.get(s.suggested.categoryId ?? "") ?? null)
        : s.suggested.state === "resting" && s.suggested.categoryId
          ? `resting from ${nameOf.get(s.suggested.categoryId) ?? "?"}`
          : s.suggested.state;
  const acceptable = visible.filter((s) => s.suggested && !s.isStaged);
  const acceptAll = () =>
    run(() =>
      stage(
        acceptable.map((s) => ({
          songId: s.id,
          state: s.suggested!.state,
          categoryId: s.suggested!.categoryId,
          reason: "Filed this way in RadioDJ",
        })),
      ),
    );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter by artist, title, album or subcat…"
          className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm text-neutral-100 sm:w-72"
        />
        {!readOnly && (
          <div className="flex items-center gap-2 text-sm text-neutral-400">
            {selected.size} selected
            <CategoryPicker options={options} value={bulkTarget} onChange={setBulkTarget} disabled={pending} />
            <button
              onClick={() => place([...selected], bulkTarget).then(() => setSelected(new Set()))}
              disabled={pending || selected.size === 0 || !bulkTarget}
              className="rounded bg-blue-700 px-3 py-1 text-sm font-medium text-white hover:bg-blue-600 disabled:opacity-50"
            >
              Stage
            </button>
          </div>
        )}
        {!readOnly && acceptable.length > 0 && (
          <button
            onClick={acceptAll}
            disabled={pending}
            className="rounded border border-neutral-700 px-3 py-1 text-sm text-neutral-200 hover:bg-neutral-900 disabled:opacity-50"
            title="Stage every shown song where RadioDJ's subcategory already says where it goes"
          >
            Accept RadioDJ&apos;s filing ({acceptable.length})
          </button>
        )}
        {stagedCount > 0 && (
          <a href="/music/changes" className="text-sm text-neutral-300 hover:underline">
            {stagedCount} staged — review changes →
          </a>
        )}
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead>
            <tr className="border-b border-neutral-800 text-neutral-400">
              <th className="w-8 py-2">
                {!readOnly && (
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    onChange={toggleAll}
                    aria-label="Select all shown"
                  />
                )}
              </th>
              <th className="py-2 font-medium">Artist</th>
              <th className="py-2 font-medium">Title</th>
              <th className="py-2 font-medium">RadioDJ</th>
              <th className="py-2 text-right font-medium">Length</th>
              <th className="py-2 pl-6 font-medium">Pool</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((s) => (
              <tr key={s.id} className={`border-b border-neutral-900 ${s.enabled ? "" : "text-neutral-600"}`}>
                <td className="py-1.5">
                  {!readOnly && (
                    <input
                      type="checkbox"
                      checked={selected.has(s.id)}
                      onChange={() => toggle(s.id)}
                      aria-label={`Select ${s.artist ?? ""} ${s.title ?? ""}`}
                    />
                  )}
                </td>
                <td className="py-1.5">{s.artist ?? "—"}</td>
                <td className="py-1.5">
                  {s.title ?? "—"}
                  {!s.enabled && <span className="ml-2 text-xs uppercase tracking-wide">disabled</span>}
                  {s.album && <span className="block text-xs text-neutral-500">{s.album}</span>}
                </td>
                <td className="py-1.5 text-neutral-400">
                  subcat {s.rdjSubcategoryId ?? "—"}
                  {suggestionLabel(s) && (
                    <span className="block text-xs text-neutral-300">filed as {suggestionLabel(s)}</span>
                  )}
                  {s.songType != null && s.songType !== 0 && (
                    <span className="ml-2 text-xs text-neutral-500">
                      {SONG_TYPE[s.songType] ?? `type ${s.songType}`}
                    </span>
                  )}
                </td>
                <td className="py-1.5 text-right tabular-nums text-neutral-400">{fmtDuration(s.durationMs)}</td>
                <td className="py-1.5 pl-6">
                  {readOnly ? (
                    <span className="text-neutral-500">none</span>
                  ) : (
                    <CategoryPicker
                      options={options}
                      value={s.stagedCategoryId ?? ""}
                      onChange={(c) => place([s.id], c)}
                      disabled={pending}
                    />
                  )}
                  {s.isStaged && (
                    <span className="ml-2 text-xs uppercase tracking-wide text-sky-300">
                      staged{s.stagedCategoryId ? "" : ` · ${suggestionLabel(s) ?? "no pool"}`}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {visible.length === 0 && songs.length > 0 && (
        <p className="text-sm text-neutral-500">No song matches the filter.</p>
      )}
    </div>
  );
}
