import "dotenv/config";
import type { SyncedSong } from "@rotavox/schema";
import { pool } from "./db.js";
import { api, closeScheduler } from "./scheduler.js";
import { loadSchemaMap, requireCanonical, findColumn } from "./schema-map.js";

const EPOCH = new Date(0);

async function getWatermark(): Promise<Date> {
  return (await api("libraryWatermark")).watermark ?? EPOCH;
}

export type Log = (line: string) => void;

const UPSERT_BATCH = 500;

export interface SyncResult {
  /** Songs RadioDJ reported changed since the watermark. */
  fetched: number;
  /** Songs the drift check found out of step and re-pulled. */
  repaired: number;
}

/**
 * One library sync: the incremental pull by date_modified, then the drift check over the
 * whole library. Leaves both pools open: the CLI closes them, the Runner keeps them.
 */
export async function syncLibrary(log: Log = console.log): Promise<SyncResult> {
  const map = loadSchemaMap();
  const songsTable = map.tables.songs;
  const subcategoryTable = map.tables.subcategory;
  if (!songsTable || !subcategoryTable) {
    throw new Error("schema-map.json is missing the songs or subcategory table — rerun `npm run introspect`.");
  }

  const songIdCol = requireCanonical(map, "song_id");
  const artistCol = requireCanonical(map, "artist");
  const titleCol = requireCanonical(map, "title");
  const albumCol = requireCanonical(map, "album");
  const pathCol = requireCanonical(map, "path");
  const durationCol = requireCanonical(map, "duration");
  const subcategoryIdCol = requireCanonical(map, "subcategory_id");
  const genreIdCol = requireCanonical(map, "genre_id");
  const enabledCol = requireCanonical(map, "enabled");
  const songTypeCol = requireCanonical(map, "song_type");
  const dateModifiedCol = requireCanonical(map, "date_modified");
  const cueTimesCol = findColumn(map, "songs", "cue_times");
  const parentIdCol = map.categoryDerivation?.subcategoryParentIdColumn;
  if (!parentIdCol) {
    throw new Error("schema-map.json has no category derivation info — rerun `npm run introspect`.");
  }

  // category_id isn't on songs — resolve via subcategory.parentid, once per run.
  const [subcatRows] = await pool.query<any[]>(
    `SELECT ID, \`${parentIdCol}\` AS parentId FROM \`${subcategoryTable}\``
  );
  const categoryBySubcat = new Map<number, number>();
  for (const row of subcatRows) categoryBySubcat.set(row.ID, row.parentId);

  const watermark = await getWatermark();
  log(`Syncing songs with ${dateModifiedCol} > ${watermark.toISOString()}`);

  const SELECT_COLS =
    `SELECT \`${songIdCol}\` AS rdjSongId, \`${artistCol}\` AS artist, \`${titleCol}\` AS title, \`${albumCol}\` AS album,
            \`${pathCol}\` AS path, \`${durationCol}\` AS duration, \`${subcategoryIdCol}\` AS subcategoryId,
            \`${genreIdCol}\` AS genreId, \`${enabledCol}\` AS enabled, \`${songTypeCol}\` AS songType,
            \`${dateModifiedCol}\` AS dateModified${cueTimesCol ? `, \`${cueTimesCol}\` AS cueTimes` : ""}
     FROM \`${songsTable}\``;

  const [rows] = await pool.query<any[]>(
    `${SELECT_COLS} WHERE \`${dateModifiedCol}\` > ? ORDER BY \`${dateModifiedCol}\` ASC`,
    [watermark]
  );

  log(
    rows.length === 0
      ? "No songs changed since last sync."
      : `Fetched ${rows.length} changed song(s).`
  );

  /**
   * RadioDJ stores cue points as `&sta=..&xta=..&end=..&fin=..&fou=..` in seconds.
   * The next track starts at `xta`, so the length that matters for scheduling is
   * xta - sta, not the file duration. Returns null when the field is absent or
   * unparseable, in which case the caller falls back to file duration.
   */
  const effectiveMs = (cue: string | null | undefined, fileMs: number | null): number | null => {
    if (!cue) return null;
    const num = (key: string): number | null => {
      const m = new RegExp(`[&?]${key}=([0-9.]+)`).exec(cue);
      const v = m ? Number(m[1]) : NaN;
      return Number.isFinite(v) ? v : null;
    };
    const sta = num("sta") ?? 0;
    const xta = num("xta") ?? num("end");
    if (xta == null) return null;
    const ms = Math.round((xta - sta) * 1000);
    // Guard against nonsense cue data producing a zero-length or absurd track.
    if (ms <= 0) return null;
    if (fileMs != null && ms > fileMs * 1.5) return null;
    return ms;
  };

  // Watermark is always the max value actually observed in a synced batch, never the
  // local clock's `now()` — M0's spike hit exactly this bug comparing across a runner
  // host / DB server clock skew, so that mistake isn't repeated here. It moves in the same
  // call as the batch it came from.
  const upsertAll = async (batch: any[], watermark?: Date): Promise<void> => {
  const synced: SyncedSong[] = [];
  for (const row of batch) {
    const rdjCategoryId = categoryBySubcat.get(row.subcategoryId) ?? null;
    // Core fields only — extended metadata (era/tempo/energy/mood/...) is
    // Scheduler-owned and is deliberately absent from both values and the
    // onConflictDoUpdate set below, so a re-sync can never clobber it.
    const coreFields = {
      artist: row.artist,
      title: row.title,
      album: row.album,
      durationMs: row.duration != null ? Math.round(Number(row.duration) * 1000) : null,
      effectiveDurationMs: effectiveMs(
        row.cueTimes,
        row.duration != null ? Math.round(Number(row.duration) * 1000) : null
      ),
      path: row.path,
      rdjSubcategoryId: row.subcategoryId,
      rdjCategoryId,
      rdjGenreId: row.genreId,
      enabled: Boolean(row.enabled),
      songType: row.songType,
    };

    synced.push({ rdjSongId: row.rdjSongId, ...coreFields });
  }
  // Batches keep each API call a sensible size; only the last carries the watermark, so
  // a failure partway leaves it where the next run will re-fetch from.
  for (let i = 0; i < synced.length; i += UPSERT_BATCH) {
    const last = i + UPSERT_BATCH >= synced.length;
    await api("upsertSongs", { songs: synced.slice(i, i + UPSERT_BATCH), watermark: last ? watermark : undefined });
  }
  };

  if (rows.length > 0) {
    const maxDateModified: Date = rows.reduce(
      (max, r) => (r.dateModified > max ? r.dateModified : max),
      rows[0].dateModified
    );
    await upsertAll(rows, maxDateModified);
    log(`Synced ${rows.length} song(s). New watermark: ${maxDateModified.toISOString()}`);
  }

  /**
   * DRIFT REPAIR — the watermark cannot be trusted on its own.
   *
   * The watermark filters on `date_modified`, but apply-changeset.ts moves songs with
   * `UPDATE songs SET id_subcat = ...` and never touches that column, because
   * date_modified means "the file's metadata changed" and writing to it to signal a
   * pool move would be both semantically wrong and an unnecessary widening of our
   * write surface against RadioDJ (ADR-0001 §3.3).
   *
   * The consequence was silent and severe: on 2026-08-02 four applied changesets were
   * completely invisible to an incremental sync, leaving the mirror describing a
   * pre-M4 library — H2 absent entirely, R2 and R3 empty. Seeding against that would
   * have mapped every category to the wrong songs, and the seed's own assertions could
   * not have caught it, because every category WOULD have had songs in it.
   *
   * So rather than making the applier and the sync coordinate, the sync verifies
   * itself. Pulling three small columns for the whole library is cheap (~1.6k rows),
   * and it repairs divergence from ANY cause -- changesets, hand edits in RadioDJ, a
   * missed run -- instead of only the causes we thought to anticipate.
   *
   * Artist and title are compared too, since set_tags (2026-10-17) rewrites them the same
   * way, without touching date_modified. They feed artist/title separation, so a mirror
   * holding the old strings keeps scheduling "The Goo Goo Dolls" and "Goo Goo Dolls" as
   * two acts.
   *
   * song_type too: retyping imaging by hand (2026-10-28, 28 renders from sweeper to
   * jingle and promo) leaves date_modified alone as well.
   */
  const [live] = await pool.query<any[]>(
    `SELECT \`${songIdCol}\` AS id, \`${subcategoryIdCol}\` AS subcat, \`${enabledCol}\` AS enabled,
            \`${artistCol}\` AS artist, \`${titleCol}\` AS title, \`${songTypeCol}\` AS songType
     FROM \`${songsTable}\``
  );
  const mirror = await api("libraryMirror");

  const mirrorById = new Map(mirror.map((m) => [m.id, m]));
  const drifted: number[] = [];
  for (const row of live) {
    const m = mirrorById.get(row.id);
    // Absent from the mirror, or disagreeing on pool/enabled/tags/type -- either way, re-pull it.
    if (
      !m ||
      m.subcat !== row.subcat ||
      m.enabled !== Boolean(row.enabled) ||
      m.artist !== row.artist ||
      m.title !== row.title ||
      m.songType !== row.songType
    ) {
      drifted.push(row.id);
    }
  }

  if (drifted.length === 0) {
    log("Drift check: mirror matches RadioDJ.");
  } else {
    log(`Drift check: ${drifted.length} song(s) disagree with RadioDJ — repairing.`);
    // Chunked: a single IN () with thousands of ids can exceed max_allowed_packet.
    for (let i = 0; i < drifted.length; i += 500) {
      const chunk = drifted.slice(i, i + 500);
      const [repair] = await pool.query<any[]>(
        `${SELECT_COLS} WHERE \`${songIdCol}\` IN (${chunk.map(() => "?").join(",")})`,
        chunk
      );
      await upsertAll(repair);
    }
    log(`Repaired ${drifted.length} song(s).`);
  }

  await api("markLibrarySynced");

  // Deletions are NOT handled here -- a purged row simply stops appearing, so it cannot
  // be detected by diffing rows that exist. That is prune-library.ts's job, and it
  // disables rather than deletes to preserve log_items and play_history references.

  return { fetched: rows.length, repaired: drifted.length };
}

if (process.argv[1]?.endsWith("sync-library.ts")) {
  syncLibrary()
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(async () => {
      await pool.end();
      await closeScheduler();
    });
}
