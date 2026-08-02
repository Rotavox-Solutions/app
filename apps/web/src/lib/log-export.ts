import { and, asc, eq } from "drizzle-orm";
import { db } from "./db";
import { categories, clockPositions, logItems, logs, playHistory, songs, stations } from "@rotavox/schema";

/**
 * Tier-0 log export (ADR-0001 §3.5c).
 *
 * At tier 0 Rotavox grants nothing to the playout system and the playout system grants
 * nothing back: the deliverable is a file the station ingests itself. This is the core
 * product's output, and it has to stand on its own without any adapter present.
 *
 * Two formats, chosen because between them they cover essentially every playout system:
 *   m3u  — extended M3U8 with #EXTINF. Universally ingestible, carries file paths.
 *   csv  — scheduled time, artist, title, duration, category, path. For systems that
 *          import a schedule rather than a playlist.
 */
export type ExportFormat = "m3u" | "csv";

export interface ExportResult {
  body: string;
  contentType: string;
  filename: string;
}

const csvCell = (v: unknown): string => {
  const s = v == null ? "" : String(v);
  // Quote when the value could otherwise break the row. Doubling embedded quotes is the
  // RFC 4180 escape; a bare quote inside an unquoted field is what corrupts imports.
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const stamp = (d: Date | null): string =>
  d ? d.toISOString().replace("T", " ").slice(0, 19) : "";

export async function exportLog(logId: string, format: ExportFormat): Promise<ExportResult | null> {
  const [log] = await db.select().from(logs).where(eq(logs.id, logId));
  if (!log) return null;

  const rows = await db
    .select({
      item: logItems,
      artist: songs.artist,
      title: songs.title,
      path: songs.path,
      durationMs: songs.durationMs,
      effectiveDurationMs: songs.effectiveDurationMs,
      categoryName: categories.name,
    })
    .from(logItems)
    .leftJoin(songs, eq(songs.id, logItems.songId))
    .leftJoin(clockPositions, eq(clockPositions.id, logItems.clockPositionId))
    .leftJoin(categories, eq(categories.id, clockPositions.categoryId))
    .where(eq(logItems.logId, logId))
    .orderBy(asc(logItems.sortOrder));

  const day = log.startsAt.toISOString().slice(0, 10);
  const base = `rotavox-log-${day}`;

  if (format === "m3u") {
    const lines = [
      "#EXTM3U",
      `#PLAYLIST:Rotavox ${day} ${log.startsAt.toISOString().slice(11, 16)}`,
    ];
    for (const r of rows) {
      if (!r.path) continue; // a fixed_event with no underlying file has nothing to play
      const secs = Math.round((r.effectiveDurationMs ?? r.durationMs ?? 0) / 1000);
      const label = [r.artist, r.title].filter(Boolean).join(" - ") || "Unknown";
      lines.push(`#EXTINF:${secs},${label}`);
      lines.push(r.path);
    }
    return {
      body: lines.join("\r\n") + "\r\n", // CRLF: several Windows playout systems require it
      contentType: "audio/x-mpegurl; charset=utf-8",
      filename: `${base}.m3u8`,
    };
  }

  const header = [
    "scheduled_at", "sort_order", "element_type", "category",
    "artist", "title", "duration_seconds", "rdj_song_id", "path",
  ];
  const out = [header.join(",")];
  for (const r of rows) {
    out.push([
      stamp(r.item.projectedAirAt),
      r.item.sortOrder,
      r.item.elementType,
      r.categoryName ?? "",
      r.artist ?? "",
      r.title ?? "",
      Math.round((r.effectiveDurationMs ?? r.durationMs ?? 0) / 1000),
      r.item.rdjSongId ?? "",
      r.path ?? "",
    ].map(csvCell).join(","));
  }
  return {
    body: out.join("\r\n") + "\r\n",
    contentType: "text/csv; charset=utf-8",
    filename: `${base}.csv`,
  };
}

/**
 * Record an approved log's items as `assumed` play history.
 *
 * Without an as-played feed the engine has no separation memory whatsoever — every
 * generation would treat the library as never played. Assuming the approved log aired
 * is optimistic, but an approved log almost always does air, and being approximately
 * right about separation beats being certainly blind.
 *
 * Only runs when the station is flagged; where reconciliation exists these rows would
 * double-count against the real ones.
 */
export async function recordAssumedAirplay(logId: string): Promise<number> {
  const [log] = await db.select().from(logs).where(eq(logs.id, logId));
  if (!log) return 0;

  const [station] = await db.select().from(stations).where(eq(stations.id, log.stationId));
  if (!station?.assumeLogAired) return 0;

  const rows = await db
    .select({ item: logItems, artist: songs.artist })
    .from(logItems)
    .leftJoin(songs, eq(songs.id, logItems.songId))
    .where(and(eq(logItems.logId, logId), eq(logItems.elementType, "music")));

  const values = rows
    .filter((r) => r.item.rdjSongId != null && r.item.projectedAirAt != null)
    .map((r) => ({
      stationId: log.stationId,
      songId: r.item.songId,
      rdjSongId: r.item.rdjSongId!,
      artist: r.artist,
      airedAt: r.item.projectedAirAt!,
      source: "assumed" as const,
      // No RadioDJ history row exists to key on, so the reconciliation unique index
      // cannot dedupe these. Re-approving is idempotent because approveLog returns
      // early once the log is already approved.
      rdjHistoryId: null,
    }));

  if (!values.length) return 0;
  await db.insert(playHistory).values(values);
  return values.length;
}
