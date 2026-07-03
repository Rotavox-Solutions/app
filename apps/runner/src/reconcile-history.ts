import "dotenv/config";
import { eq, and, inArray } from "drizzle-orm";
import { playHistory, songs, syncState } from "@rotavox/schema";
import { pool } from "./db.js";
import { schedulerDb, pgClient, stationId } from "./scheduler-db.js";
import { loadSchemaMap, guessHistoryColumns, findColumn } from "./schema-map.js";

const SYNC_KEY = "history_reconcile";
const BATCH_SIZE = 500;

export interface ReconciledRow {
  rdjSongId: number;
  airedAt: Date;
}

async function getWatermark(): Promise<number> {
  const [row] = await schedulerDb
    .select()
    .from(syncState)
    .where(and(eq(syncState.stationId, stationId), eq(syncState.syncKey, SYNC_KEY)));
  return row?.watermark ? Number(row.watermark) : 0;
}

/**
 * RadioDJ's MariaDB server clock reads behind true UTC (M0 found ~1hr; measured
 * ~60.0min here) — a stable, systematic skew (DST/timezone config on that box),
 * not drift. `date_played` is written using that same clock, so every row read
 * from `history` needs this correction before being treated as an absolute UTC
 * instant. M0's spike script applied this locally for a relative comparison and
 * was retired; this is the first place that ever needed it for an absolute
 * timestamp stored in Postgres (play_history.aired_at) — undetected until M3's
 * live pacing needed sub-minute cross-system accuracy to compare against
 * pushed_at/projected_air_at (both true UTC, from Node's own clock).
 */
async function getDbClockOffsetMs(): Promise<number> {
  const before = Date.now();
  const [rows] = await pool.query<any[]>("SELECT NOW() as dbNow");
  const after = Date.now();
  const trueUtcMid = (before + after) / 2;
  return trueUtcMid - new Date(rows[0].dbNow).getTime();
}

/**
 * Reads new RadioDJ history rows since the watermark and writes them to
 * play_history. Returns the rows just inserted (chronological, across all
 * batches) so callers (the pace loop) can immediately backfill log_items.aired_at
 * without re-querying. Does NOT close the DB connections — long-lived callers
 * (pace.ts) own that lifecycle; see main() below for the standalone-script case.
 */
export async function reconcileHistory(): Promise<ReconciledRow[]> {
  const map = loadSchemaMap();
  const historyTable = map.tables.history;
  if (!historyTable) {
    throw new Error("schema-map.json is missing the history table — rerun `npm run introspect`.");
  }
  const { pk: idCol, fk: trackIdCol, ts: datePlayedCol } = guessHistoryColumns(map);
  const artistCol = findColumn(map, "history", "artist");

  let watermark = await getWatermark();
  const allReconciled: ReconciledRow[] = [];
  const clockOffsetMs = await getDbClockOffsetMs();

  for (;;) {
    const [rows] = await pool.query<any[]>(
      `SELECT \`${idCol}\` AS id, \`${trackIdCol}\` AS rdjSongId, \`${datePlayedCol}\` AS datePlayed
              ${artistCol ? `, \`${artistCol}\` AS artist` : ""}
       FROM \`${historyTable}\`
       WHERE \`${idCol}\` > ?
       ORDER BY \`${idCol}\` ASC
       LIMIT ${BATCH_SIZE}`,
      [watermark]
    );

    if (rows.length === 0) break;

    const rdjSongIds = [...new Set(rows.map((r) => r.rdjSongId))];
    const mirrorRows = await schedulerDb
      .select({ id: songs.id, rdjSongId: songs.rdjSongId })
      .from(songs)
      .where(and(eq(songs.stationId, stationId), inArray(songs.rdjSongId, rdjSongIds)));
    const songIdByRdjId = new Map(mirrorRows.map((r) => [r.rdjSongId, r.id]));

    const batchMaxId = Math.max(...rows.map((r) => r.id));
    const correctedAiredAt = new Map<number, Date>(
      rows.map((row) => [row.id, new Date(new Date(row.datePlayed).getTime() + clockOffsetMs)])
    );

    await schedulerDb.transaction(async (tx) => {
      await tx
        .insert(playHistory)
        .values(
          rows.map((row) => ({
            stationId,
            songId: songIdByRdjId.get(row.rdjSongId) ?? null,
            rdjSongId: row.rdjSongId,
            artist: row.artist ?? null,
            airedAt: correctedAiredAt.get(row.id)!,
            source: "reconciled" as const,
            rdjHistoryId: row.id,
          }))
        )
        // Guards against reprocessing a batch after a crash between this insert
        // and the watermark bump below — both happen in the same transaction.
        .onConflictDoNothing({ target: [playHistory.stationId, playHistory.rdjHistoryId] });

      await tx
        .insert(syncState)
        .values({ stationId, syncKey: SYNC_KEY, watermark: String(batchMaxId) })
        .onConflictDoUpdate({
          target: [syncState.stationId, syncState.syncKey],
          set: { watermark: String(batchMaxId), updatedAt: new Date() },
        });
    });

    watermark = batchMaxId;
    console.log(`Reconciled batch of ${rows.length} row(s), watermark now ${watermark}.`);
    for (const row of rows) allReconciled.push({ rdjSongId: row.rdjSongId, airedAt: correctedAiredAt.get(row.id)! });

    if (rows.length < BATCH_SIZE) break;
  }

  return allReconciled;
}

async function main() {
  const reconciled = await reconcileHistory();
  console.log(`Done. ${reconciled.length} history row(s) processed.`);
  await pool.end();
  await pgClient.end();
}

if (process.argv[1]?.endsWith("reconcile-history.ts")) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
