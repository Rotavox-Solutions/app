import "dotenv/config";
import { eq, and, inArray } from "drizzle-orm";
import { playHistory, songs, syncState } from "@rotavox/schema";
import { pool } from "./db.js";
import { schedulerDb, pgClient, stationId } from "./scheduler-db.js";
import { loadSchemaMap, guessHistoryColumns, findColumn } from "./schema-map.js";

const SYNC_KEY = "history_reconcile";
const BATCH_SIZE = 500;

async function getWatermark(): Promise<number> {
  const [row] = await schedulerDb
    .select()
    .from(syncState)
    .where(and(eq(syncState.stationId, stationId), eq(syncState.syncKey, SYNC_KEY)));
  return row?.watermark ? Number(row.watermark) : 0;
}

async function main() {
  const map = loadSchemaMap();
  const historyTable = map.tables.history;
  if (!historyTable) {
    throw new Error("schema-map.json is missing the history table — rerun `npm run introspect`.");
  }
  const { pk: idCol, fk: trackIdCol, ts: datePlayedCol } = guessHistoryColumns(map);
  const artistCol = findColumn(map, "history", "artist");

  let watermark = await getWatermark();
  console.log(`Reconciling history with ${idCol} > ${watermark}`);

  let totalInserted = 0;
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

    await schedulerDb.transaction(async (tx) => {
      await tx
        .insert(playHistory)
        .values(
          rows.map((row) => ({
            stationId,
            songId: songIdByRdjId.get(row.rdjSongId) ?? null,
            rdjSongId: row.rdjSongId,
            artist: row.artist ?? null,
            airedAt: row.datePlayed,
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
    totalInserted += rows.length;
    console.log(`Reconciled batch of ${rows.length} row(s), watermark now ${watermark}.`);

    if (rows.length < BATCH_SIZE) break;
  }

  console.log(`Done. ${totalInserted} history row(s) processed. Final watermark: ${watermark}.`);

  await pool.end();
  await pgClient.end();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
