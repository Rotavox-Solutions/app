import "dotenv/config";
import { pool } from "./db.js";
import type { HistoryRow } from "@rotavox/schema";
import { api, closeScheduler } from "./scheduler.js";
import { loadSchemaMap, guessHistoryColumns, findColumn } from "./schema-map.js";

const BATCH_SIZE = 500;

export interface ReconciledRow {
  rdjSongId: number;
  airedAt: Date;
}

/**
 * Where reconciliation resumes and where its rows go. The pacer's is its log copy, so
 * history read during an outage waits on disk (log-store.ts); this script's own run
 * talks to Rotavox directly.
 */
export interface HistorySink {
  /** The RadioDJ history id to resume after, or null when it isn't known yet. */
  watermark(): Promise<number | null>;
  record(batch: { watermark: number; rows: HistoryRow[] }): Promise<void>;
}

const directSink: HistorySink = {
  watermark: async () => (await api("historyWatermark")).watermark,
  record: async (batch) => {
    await api("recordHistory", batch);
  },
};

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
export async function reconcileHistory(sink: HistorySink = directSink): Promise<ReconciledRow[]> {
  const map = loadSchemaMap();
  const historyTable = map.tables.history;
  if (!historyTable) {
    throw new Error("schema-map.json is missing the history table — rerun `npm run introspect`.");
  }
  const { pk: idCol, fk: trackIdCol, ts: datePlayedCol } = guessHistoryColumns(map);
  const artistCol = findColumn(map, "history", "artist");

  // Unknown only when the pacer has neither a saved copy nor reached Rotavox yet. Starting
  // from 0 then would read the station's whole history; wait for the real watermark.
  let watermark = await sink.watermark();
  if (watermark === null) return [];
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

    const batchMaxId = Math.max(...rows.map((r) => r.id));
    const correctedAiredAt = new Map<number, Date>(
      rows.map((row) => [row.id, new Date(new Date(row.datePlayed).getTime() + clockOffsetMs)])
    );

    // The rows and the watermark bump land in one transaction on the Rotavox side, and
    // rows already recorded are skipped, so reprocessing a batch after a crash is harmless.
    await sink.record({
      watermark: batchMaxId,
      rows: rows.map((row) => ({
        rdjHistoryId: row.id,
        rdjSongId: row.rdjSongId,
        artist: row.artist ?? null,
        airedAt: correctedAiredAt.get(row.id)!,
      })),
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
  await closeScheduler();
}

if (process.argv[1]?.endsWith("reconcile-history.ts")) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
