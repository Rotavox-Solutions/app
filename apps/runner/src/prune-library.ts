import "dotenv/config";
import { and, eq, inArray, notInArray } from "drizzle-orm";
import { songs } from "@rotavox/schema";
import { pool } from "./db.js";
import { schedulerDb, pgClient, stationId } from "./scheduler-db.js";
import { loadSchemaMap, requireCanonical } from "./schema-map.js";

/**
 * Deletion reconciliation for the library mirror.
 *
 * sync-library.ts is upsert-only and watermarked on `date_modified`, so it can never
 * see a DELETE: a purged row doesn't get a modified timestamp, it just stops appearing
 * in the result set. Purged songs therefore stay in the mirror indefinitely, stay
 * schedulable, get pushed by ID, and RadioDJ skips them at playout — which reads as
 * random dead slots in the log rather than as a sync problem.
 *
 * This closes that hole by diffing the mirror against the live song ID set.
 *
 * Orphans are DISABLED, never deleted: `songs.id` is referenced by `log_items` and
 * `play_history`, so deleting would either break those FKs or silently destroy
 * as-played history. `basePool` filters on `enabled === true`, so disabling is
 * sufficient to remove them from all future scheduling while keeping past logs
 * readable. A song that comes back in RadioDJ is re-enabled by the next sync-library
 * run, since `enabled` is in its core-field set.
 */
async function main(): Promise<void> {
  const map = loadSchemaMap();
  const songsTable = map.tables.songs;
  if (!songsTable) {
    throw new Error("schema-map.json is missing the songs table — rerun `npm run introspect`.");
  }
  const songIdCol = requireCanonical(map, "song_id");

  const [liveRows] = await pool.query<any[]>(
    `SELECT \`${songIdCol}\` AS rdjSongId FROM \`${songsTable}\``
  );
  const liveIds = liveRows.map((r) => Number(r.rdjSongId)).filter((n) => Number.isFinite(n));

  // A zero-row read is far more likely to be a broken query or a pointed-at-the-wrong
  // database than a genuinely empty library — and acting on it would disable every
  // song the station has. Refuse rather than guess.
  if (liveIds.length === 0) {
    throw new Error(
      `Read 0 songs from RadioDJ's \`${songsTable}\` — refusing to prune, since that would disable the entire mirror. Check the DB connection and schema map.`
    );
  }

  const orphans = await schedulerDb
    .select({ id: songs.id, rdjSongId: songs.rdjSongId, artist: songs.artist, title: songs.title })
    .from(songs)
    .where(
      and(
        eq(songs.stationId, stationId),
        eq(songs.enabled, true),
        notInArray(songs.rdjSongId, liveIds)
      )
    );

  console.log(`RadioDJ has ${liveIds.length} song(s); mirror has ${orphans.length} enabled orphan(s).`);

  if (orphans.length === 0) {
    console.log("Nothing to prune.");
    await pool.end();
    await pgClient.end();
    return;
  }

  for (const o of orphans) {
    console.log(`  disabling rdj:${o.rdjSongId} — ${o.artist ?? "?"} — ${o.title ?? "?"}`);
  }

  await schedulerDb
    .update(songs)
    .set({ enabled: false })
    .where(
      and(
        eq(songs.stationId, stationId),
        inArray(
          songs.id,
          orphans.map((o) => o.id)
        )
      )
    );

  console.log(`Disabled ${orphans.length} orphaned song(s).`);
  console.log(
    "Any approved log generated before this still references them — regenerate the un-aired horizon, or expect those items to skip at playout."
  );

  await pool.end();
  await pgClient.end();
}

if (process.argv[1]?.endsWith("prune-library.ts")) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
