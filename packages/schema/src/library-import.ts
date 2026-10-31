// Library import from a CSV file: the tier-0 intake (ADR-0001 §3.5c). A station with no
// Runner exports its library from its own playout system and uploads it here. Matched
// songs have their core fields updated; new songs are added, placed in the pool the file
// names if it matches one, otherwise left for the Inbox. Songs the file leaves out are
// reported, never removed. A station with a Runner gets its library from RadioDJ's sync
// and can't import, since the two would fight.
//
// parseCsv, detectMapping and planImport are pure; applyImport writes.
import { and, eq, isNull, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "./schema.js";
import { categories, runnerKeys, songs, stations } from "./schema.js";
import { ChangesetError } from "./changesets.js";
import { applyPlacements, type PlacementChange } from "./membership.js";

type Db = PostgresJsDatabase<typeof schema>;

export const IMPORT_FIELDS = ["id", "artist", "title", "album", "duration", "path", "pool", "type", "enabled"] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];
/** Column index for each field the file supplies. */
export type ImportMapping = Partial<Record<ImportField, number>>;

export const IMPORT_LIMITS = { bytes: 10 * 1024 * 1024, rows: 50_000 };

/** Header names each field is recognised by, compared without case, spaces or punctuation. */
const ALIASES: Record<ImportField, string[]> = {
  id: ["id", "songid", "rdjsongid", "cart", "cartnumber", "cartno", "number", "trackid"],
  artist: ["artist", "artists", "performer"],
  title: ["title", "song", "songtitle", "track", "tracktitle", "name"],
  album: ["album", "albumtitle", "release"],
  duration: ["duration", "length", "durationseconds", "lengthseconds", "durationms", "time", "runtime"],
  path: ["path", "file", "filename", "filepath", "location", "url"],
  pool: ["pool", "category", "subcategory", "rotation", "rotationcategory", "group"],
  type: ["type", "songtype", "elementtype", "kind"],
  enabled: ["enabled", "active", "status"],
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * RFC 4180 CSV: quoted fields with doubled quotes and embedded line breaks, CRLF or LF,
 * a leading byte-order mark ignored. The delimiter is whichever of comma, semicolon or
 * tab the header line uses most, since European exports often use semicolons.
 */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const firstLine = src.slice(0, src.search(/\r?\n|$/));
  const delimiter = [",", ";", "\t"].reduce((best, d) =>
    firstLine.split(d).length > firstLine.split(best).length ? d : best
  );
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"' && field === "") quoted = true;
    else if (c === delimiter) {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim() !== ""));
}

/** Matches header names to fields; each column is used at most once. */
export function detectMapping(header: string[]): ImportMapping {
  const mapping: ImportMapping = {};
  const used = new Set<number>();
  for (const field of IMPORT_FIELDS) {
    const i = header.findIndex((h, idx) => !used.has(idx) && ALIASES[field].includes(norm(h)));
    if (i >= 0) {
      mapping[field] = i;
      used.add(i);
    }
  }
  return mapping;
}

/** "3:45", "1:03:45", "225" (seconds) or "225000" (milliseconds) → milliseconds. */
export function parseDuration(text: string): number | null {
  const t = text.trim();
  if (!t) return null;
  if (t.includes(":")) {
    const parts = t.split(":").map(Number);
    if (parts.some((p) => Number.isNaN(p))) return null;
    const secs = parts.reduce((acc, p) => acc * 60 + p, 0);
    return Math.round(secs * 1000);
  }
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return null;
  // No song runs ten thousand seconds; a number that big is milliseconds.
  return Math.round(n > 10_000 ? n : n * 1000);
}

const SONG_TYPES: Record<string, number> = {
  music: 0, song: 0, "0": 0,
  jingle: 1, id: 1, stationid: 1, "1": 1,
  sweeper: 2, liner: 2, imaging: 2, promo: 2, "2": 2,
  voiceover: 3, voicetrack: 3, vo: 3, "3": 3,
};

function parseEnabled(text: string): boolean | null {
  const t = norm(text);
  if (!t) return null;
  if (["1", "yes", "y", "true", "enabled", "active", "on"].includes(t)) return true;
  if (["0", "no", "n", "false", "disabled", "inactive", "off"].includes(t)) return false;
  return null;
}

export interface ImportSong {
  rdjSongId: number | null;
  artist: string | null;
  title: string | null;
  album: string | null;
  durationMs: number | null;
  path: string | null;
  pool: string | null;
  songType: number;
  enabled: boolean;
}

export interface ExistingSong {
  id: string;
  rdjSongId: number;
  artist: string | null;
  title: string | null;
  album: string | null;
  durationMs: number | null;
  path: string | null;
  songType: number | null;
  enabled: boolean | null;
}

export type PlanAction = "create" | "update" | "unchanged" | "skip";

export interface PlanRow {
  line: number;
  action: PlanAction;
  song: ImportSong;
  /** The song it matched, for an update or unchanged row. */
  existingId: string | null;
  /** Fields that change, for an update. */
  changes: string[];
  /** Why a row is skipped. */
  reason: string | null;
}

export interface ImportPlan {
  header: string[];
  mapping: ImportMapping;
  rows: PlanRow[];
  counts: Record<PlanAction, number>;
  /** Songs Rotavox has that the file doesn't list. Reported, never removed. */
  notInFile: number;
  /** What songs are matched by. */
  matchBy: "id" | "path" | "artist and title";
  problems: string[];
}

const blank = (s: string | undefined) => {
  const t = (s ?? "").trim();
  return t === "" ? null : t;
};

/** What the file would do to the library. Pure: the existing songs are passed in. */
export function planImport(rows: string[][], mapping: ImportMapping, existing: ExistingSong[]): ImportPlan {
  const [header = [], ...body] = rows;
  const problems: string[] = [];
  if (mapping.title == null && mapping.path == null) problems.push("Choose which column holds the title, or the file path.");
  if (body.length > IMPORT_LIMITS.rows) problems.push(`The file has ${body.length} rows; import at most ${IMPORT_LIMITS.rows} at a time.`);
  const matchBy: ImportPlan["matchBy"] = mapping.id != null ? "id" : mapping.path != null ? "path" : "artist and title";

  // A row matches on the best key it has: its song number, else its file path, else its
  // artist and title. A new song often has no number yet, and still mustn't duplicate one
  // already in the library.
  type Keyed = { rdjSongId: number | null; path: string | null; artist: string | null; title: string | null };
  const keysOf = (s: Keyed, useId: boolean, usePath: boolean) =>
    [
      useId && s.rdjSongId != null ? `id:${s.rdjSongId}` : null,
      usePath && s.path ? `path:${s.path.toLowerCase().replace(/\\/g, "/")}` : null,
      s.title ? `at:${(s.artist ?? "").toLowerCase().trim()}|${s.title.toLowerCase().trim()}` : null,
    ].filter((k): k is string => !!k);
  // The retired mirror (rdj_song_id <= 0) isn't inventory and never matches.
  const byKey = new Map<string, ExistingSong>();
  for (const e of existing) {
    if (e.rdjSongId <= 0) continue;
    for (const k of keysOf(e, mapping.id != null, mapping.path != null)) if (!byKey.has(k)) byKey.set(k, e);
  }

  const seen = new Set<string>();
  const matched = new Set<string>();
  const out: PlanRow[] = [];
  const counts: Record<PlanAction, number> = { create: 0, update: 0, unchanged: 0, skip: 0 };
  const get = (r: string[], f: ImportField) => (mapping[f] == null ? undefined : r[mapping[f]!]);

  body.forEach((r, i) => {
    const line = i + 2;
    const idText = blank(get(r, "id"));
    const id = idText == null ? null : Number(idText);
    const typeText = norm(get(r, "type") ?? "");
    const song: ImportSong = {
      rdjSongId: id != null && Number.isInteger(id) && id > 0 ? id : null,
      artist: blank(get(r, "artist")),
      title: blank(get(r, "title")) ?? (blank(get(r, "path"))?.split(/[\\/]/).pop()?.replace(/\.[a-z0-9]+$/i, "") ?? null),
      album: blank(get(r, "album")),
      durationMs: parseDuration(get(r, "duration") ?? ""),
      path: blank(get(r, "path")),
      pool: blank(get(r, "pool")),
      songType: typeText ? SONG_TYPES[typeText] ?? 0 : 0,
      enabled: parseEnabled(get(r, "enabled") ?? "") ?? true,
    };
    const skip = (reason: string) => {
      out.push({ line, action: "skip", song, existingId: null, changes: [], reason });
      counts.skip++;
    };
    if (idText != null && song.rdjSongId == null) return skip(`"${idText}" isn't a song number`);
    if (!song.title) return skip("no title");
    const keys = keysOf(song, mapping.id != null, mapping.path != null);
    // The first key is the one the row is identified by; a second row with it is a repeat.
    if (seen.has(keys[0])) return skip("listed twice in the file");
    seen.add(keys[0]);

    const e = keys.map((k) => byKey.get(k)).find((x) => x && !matched.has(x.id));
    if (!e) {
      out.push({ line, action: "create", song, existingId: null, changes: [], reason: null });
      counts.create++;
      return;
    }
    matched.add(e.id);
    const changes: string[] = [];
    const differs = (label: string, a: unknown, b: unknown) => {
      if (a !== b) changes.push(label);
    };
    differs("artist", song.artist, e.artist);
    differs("title", song.title, e.title);
    if (mapping.album != null) differs("album", song.album, e.album);
    if (mapping.duration != null && song.durationMs != null) differs("length", song.durationMs, e.durationMs);
    if (mapping.path != null) differs("path", song.path, e.path);
    if (mapping.type != null) differs("type", song.songType, e.songType);
    if (mapping.enabled != null) differs("enabled", song.enabled, e.enabled);
    const action: PlanAction = changes.length ? "update" : "unchanged";
    out.push({ line, action, song, existingId: e.id, changes, reason: null });
    counts[action]++;
  });

  const notInFile = existing.filter((e) => e.rdjSongId > 0 && !matched.has(e.id)).length;
  if (body.length === 0) problems.push("The file has a header but no songs.");
  return { header, mapping, rows: out, counts, notInFile, matchBy, problems };
}

/**
 * Whether this station's library comes from file imports: a 'file' (tier-0) station with
 * no Runner. A RadioDJ station gets its library from the Runner's sync, and an upload would
 * fight it, even before its Runner first connects.
 */
export async function libraryFromFile(db: Db, stationId: string): Promise<boolean> {
  const [station] = await db.select({ playout: stations.playout }).from(stations).where(eq(stations.id, stationId));
  if (station?.playout !== "file") return false;
  const [key] = await db
    .select({ id: runnerKeys.id })
    .from(runnerKeys)
    .where(and(eq(runnerKeys.stationId, stationId), isNull(runnerKeys.revokedAt)))
    .limit(1);
  return !key;
}

export async function existingSongs(db: Db, stationId: string): Promise<ExistingSong[]> {
  return db
    .select({
      id: songs.id,
      rdjSongId: songs.rdjSongId,
      artist: songs.artist,
      title: songs.title,
      album: songs.album,
      durationMs: songs.durationMs,
      path: songs.path,
      songType: songs.songType,
      enabled: songs.enabled,
    })
    .from(songs)
    .where(eq(songs.stationId, stationId));
}

export interface ImportResult {
  created: number;
  updated: number;
  placed: number;
  /** New songs left in the Inbox: the file named no pool, or one Rotavox doesn't have. */
  toInbox: number;
}

/**
 * Applies a plan in one transaction. Matched songs get the fields the file supplies;
 * new songs are added, numbered after the highest number in use where the file gives
 * none, and placed in their named pool (recorded as a lifecycle event) or left for the
 * Inbox. The first import makes Rotavox the owner of this station's pools (ADR-0002 §4).
 */
export async function applyImport(db: Db, stationId: string, plan: ImportPlan, now: Date = new Date()): Promise<ImportResult> {
  if (plan.problems.length) throw new ChangesetError("invalid", plan.problems[0]);
  if (!(await libraryFromFile(db, stationId))) {
    throw new ChangesetError(
      "invalid",
      "This station's library comes from RadioDJ through the Runner, so it can't be imported from a file."
    );
  }
  return db.transaction(async (tx) => {
    const cats = await tx.select({ id: categories.id, name: categories.name }).from(categories).where(eq(categories.stationId, stationId));
    const poolByName = new Map(cats.map((c) => [c.name.toLowerCase(), c.id]));
    const [{ max }] = await tx
      .select({ max: sql<number>`coalesce(max(${songs.rdjSongId}), 0)` })
      .from(songs)
      .where(eq(songs.stationId, stationId));
    let next = Number(max);
    const taken = new Set(
      (await tx.select({ n: songs.rdjSongId }).from(songs).where(eq(songs.stationId, stationId))).map((r) => r.n)
    );

    let updated = 0;
    for (const r of plan.rows) {
      if (r.action !== "update" || !r.existingId) continue;
      const set: Partial<typeof songs.$inferInsert> = { artist: r.song.artist, title: r.song.title };
      if (plan.mapping.album != null) set.album = r.song.album;
      if (plan.mapping.duration != null && r.song.durationMs != null) set.durationMs = r.song.durationMs;
      if (plan.mapping.path != null) set.path = r.song.path;
      if (plan.mapping.type != null) set.songType = r.song.songType;
      if (plan.mapping.enabled != null) set.enabled = r.song.enabled;
      await tx.update(songs).set(set).where(and(eq(songs.id, r.existingId), eq(songs.stationId, stationId)));
      updated++;
    }

    const placements: PlacementChange[] = [];
    let created = 0;
    let toInbox = 0;
    for (const r of plan.rows) {
      if (r.action !== "create") continue;
      let n = r.song.rdjSongId;
      if (n == null || taken.has(n)) {
        do next++;
        while (taken.has(next));
        n = next;
      }
      taken.add(n);
      const [row] = await tx
        .insert(songs)
        .values({
          stationId,
          rdjSongId: n,
          artist: r.song.artist,
          title: r.song.title,
          album: r.song.album,
          durationMs: r.song.durationMs,
          path: r.song.path,
          songType: r.song.songType,
          enabled: r.song.enabled,
          lifecycleState: "active",
          lifecycleSince: now,
        })
        .returning({ id: songs.id });
      created++;
      // Every new song gets its arrival on record, in a pool or not, so its history and
      // time in pool start here.
      const pool = r.song.pool ? poolByName.get(r.song.pool.toLowerCase()) : undefined;
      if (!pool) toInbox++;
      placements.push({
        songId: row.id,
        placement: { state: "active", categoryId: pool ?? null },
        reason: pool ? `Imported from a library file into ${r.song.pool}` : "Imported from a library file",
        source: "import",
      });
    }
    await applyPlacements(tx, stationId, placements, now, { recordUnchanged: true });
    await tx
      .update(stations)
      .set({ membershipImportedAt: sql`coalesce(${stations.membershipImportedAt}, ${now.toISOString()}::timestamp)` })
      .where(eq(stations.id, stationId));
    return { created, updated, placed: created - toInbox, toInbox };
  });
}
