import "dotenv/config";
import { eq, and } from "drizzle-orm";
import { songs, syncState } from "@rotavox/schema";
import { pool } from "./db.js";
import { schedulerDb, pgClient, stationId } from "./scheduler-db.js";
import { loadSchemaMap, requireCanonical, findColumn } from "./schema-map.js";

const SYNC_KEY = "library_sync";
const EPOCH = new Date(0);

async function getWatermark(): Promise<Date> {
  const [row] = await schedulerDb
    .select()
    .from(syncState)
    .where(and(eq(syncState.stationId, stationId), eq(syncState.syncKey, SYNC_KEY)));
  return row?.watermark ? new Date(row.watermark) : EPOCH;
}

// Watermark is always the max value actually observed in a synced batch, never the
// local clock's `now()` — M0's spike hit exactly this bug comparing across a runner
// host / DB server clock skew, so that mistake isn't repeated here.
async function setWatermark(value: Date): Promise<void> {
  await schedulerDb
    .insert(syncState)
    .values({ stationId, syncKey: SYNC_KEY, watermark: value.toISOString() })
    .onConflictDoUpdate({
      target: [syncState.stationId, syncState.syncKey],
      set: { watermark: value.toISOString(), updatedAt: new Date() },
    });
}

async function main() {
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
  console.log(`Syncing songs with ${dateModifiedCol} > ${watermark.toISOString()}`);

  const [rows] = await pool.query<any[]>(
    `SELECT \`${songIdCol}\` AS rdjSongId, \`${artistCol}\` AS artist, \`${titleCol}\` AS title, \`${albumCol}\` AS album,
            \`${pathCol}\` AS path, \`${durationCol}\` AS duration, \`${subcategoryIdCol}\` AS subcategoryId,
            \`${genreIdCol}\` AS genreId, \`${enabledCol}\` AS enabled, \`${songTypeCol}\` AS songType,
            \`${dateModifiedCol}\` AS dateModified${cueTimesCol ? `, \`${cueTimesCol}\` AS cueTimes` : ""}
     FROM \`${songsTable}\`
     WHERE \`${dateModifiedCol}\` > ?
     ORDER BY \`${dateModifiedCol}\` ASC`,
    [watermark]
  );

  if (rows.length === 0) {
    console.log("No changed songs since last sync.");
    await pool.end();
    await pgClient.end();
    return;
  }

  console.log(`Fetched ${rows.length} changed song(s).`);

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

  for (const row of rows) {
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

    await schedulerDb
      .insert(songs)
      .values({ stationId, rdjSongId: row.rdjSongId, ...coreFields })
      .onConflictDoUpdate({
        target: [songs.stationId, songs.rdjSongId],
        set: coreFields,
      });
  }

  const maxDateModified: Date = rows.reduce(
    (max, r) => (r.dateModified > max ? r.dateModified : max),
    rows[0].dateModified
  );
  await setWatermark(maxDateModified);
  console.log(`Synced ${rows.length} song(s). New watermark: ${maxDateModified.toISOString()}`);

  await pool.end();
  await pgClient.end();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
