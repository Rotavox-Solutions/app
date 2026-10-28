import "dotenv/config";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { formatOffset, planUtcEvents, utcOffsetMinutes, type LocalEvent } from "@rotavox/schema";
import { pool } from "./db.js";
import { planEventWrites, type EventRow } from "./autodj-plan.js";
import { closeScheduler, stationIdentity } from "./scheduler.js";
import type { ApplyLog } from "./apply-changeset.js";

/**
 * Writes the AutoDJ fail-safe's weekly "Load Rotation" events at the station's current UTC
 * offset (ADR-0001 §3.5: a one-way projection, written ahead of the fallback needing it).
 * The plan is station-local (packages/schema/src/autodj-events.ts); RadioDJ's events are
 * UTC and know nothing of DST, so Rotavox queues this job whenever the offset changes.
 *
 * The plan lives beside the Runner in rdj-rotation-plan.json, so a box without one has
 * opted out. Only events this projection owns are touched: "Load Rotation" events named
 * "<rotation> HH:00 UTC". An owned event the plan no longer needs is reused for one it
 * does, or disabled (the RadioDJ login has no DELETE). Events already right are left alone.
 *
 * RadioDJ reads its events when it starts and when its event scheduler window closes, so
 * a rewrite takes effect on air only after someone reopens that window.
 *
 *   npm run autodj-events -w @rotavox/runner [-- --apply]
 */

export const PLAN_PATH = path.resolve(import.meta.dirname, "../rdj-rotation-plan.json");

const EVENT_COLUMNS = ["ID", "type", "time", "name", "day", "hours", "data", "enabled", "catID", "smart", "grouped"];
const ROTATION_COLUMNS = ["ID", "name"];
async function requireColumns(c: PoolConnection, table: string, wanted: string[]): Promise<void> {
  const [rows] = await c.query<RowDataPacket[]>(
    "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?",
    [table],
  );
  const have = new Set(rows.map((r) => String(r.COLUMN_NAME).toLowerCase()));
  const missing = wanted.filter((w) => !have.has(w.toLowerCase()));
  if (missing.length)
    throw new Error(
      `RadioDJ's ${table} table has no ${missing.join(", ")} (this RadioDJ differs from the one the fail-safe was built against)`,
    );
}

export interface AutodjEventsResult {
  summary: string;
  /**
   * For Rotavox to remember: the offset RadioDJ's events are now set for, "none" when this
   * box has no plan, or null when nothing was decided (a dry run that found changes).
   */
  watermark: string | null;
}

export async function projectAutodjEvents(opts: {
  apply: boolean;
  log: ApplyLog;
  timezone: string;
  now: Date;
  planPath?: string;
}): Promise<AutodjEventsResult> {
  const { apply, log, timezone, now } = opts;
  const planPath = opts.planPath ?? PLAN_PATH;
  if (!existsSync(planPath)) {
    log.info(`No AutoDJ fail-safe plan on this box (${planPath}); nothing to write.`);
    return { summary: "No fail-safe plan on this box", watermark: "none" };
  }
  const plan = JSON.parse(readFileSync(planPath, "utf8")) as { localEvents?: LocalEvent[] };
  if (!Array.isArray(plan.localEvents)) throw new Error(`${planPath} has no localEvents`);
  const offset = utcOffsetMinutes(now, timezone);
  const utc = planUtcEvents(plan.localEvents, offset);
  log.info(`${plan.localEvents.length} hourly events in ${timezone}, now ${formatOffset(offset)}.`);

  const c = await pool.getConnection();
  try {
    await requireColumns(c, "events", EVENT_COLUMNS);
    await requireColumns(c, "rotations", ROTATION_COLUMNS);
    const [rotations] = await c.query<RowDataPacket[]>("SELECT ID, name FROM rotations");
    const rotationIds = new Map(rotations.map((r) => [String(r.name), Number(r.ID)]));
    const [rows] = await c.query<RowDataPacket[]>(
      "SELECT ID, name, TIME_FORMAT(time, '%H:%i:%s') AS time, day, data, enabled FROM events WHERE type = 1",
    );
    const existing: EventRow[] = rows.map((r) => ({
      ID: Number(r.ID),
      name: String(r.name),
      time: String(r.time),
      day: String(r.day),
      data: String(r.data ?? ""),
      enabled: Number(r.enabled),
    }));
    const { writes, disable, unchanged } = planEventWrites(utc, rotationIds, existing);
    for (const w of writes) log.info(`  ${w.id ? `rewrite #${w.id}` : "add"}: ${w.name} on days ${w.day}`);
    for (const id of disable) log.info(`  disable #${id}: ${existing.find((e) => e.ID === id)?.name}`);
    log.info(`${writes.length} to write, ${disable.length} to disable, ${unchanged} already right.`);

    const changed = writes.length + disable.length;
    if (!apply || changed === 0) {
      const summary = changed
        ? `${changed} event(s) would change for ${formatOffset(offset)}`
        : `Events already set for ${formatOffset(offset)}`;
      return { summary, watermark: changed ? null : String(offset) };
    }

    await c.beginTransaction();
    try {
      for (const w of writes) {
        if (w.id) {
          await c.query(
            "UPDATE events SET type=1, time=?, name=?, day=?, hours='&', data=?, enabled=1, catID=1, smart=0, grouped=0 WHERE ID=?",
            [w.time, w.name, w.day, w.data, w.id],
          );
        } else {
          await c.query(
            "INSERT INTO events (type, time, name, day, hours, data, enabled, catID, smart, grouped) VALUES (1, ?, ?, ?, '&', ?, 1, 1, 0, 0)",
            [w.time, w.name, w.day, w.data],
          );
        }
      }
      if (disable.length) await c.query("UPDATE events SET enabled=0 WHERE ID IN (?)", [disable]);
      await c.commit();
    } catch (err) {
      await c.rollback();
      throw err;
    }
    log.info("Written. RadioDJ picks the new events up when its event scheduler window is next opened and closed.");
    return {
      summary: `${changed} event(s) rewritten for ${formatOffset(offset)}. Reopen RadioDJ's event scheduler to load them.`,
      watermark: String(offset),
    };
  } finally {
    c.release();
  }
}

if (process.argv[1]?.endsWith("autodj-events.ts")) {
  const flags = process.argv.slice(2);
  for (const f of flags) if (f !== "--apply") throw new Error(`Unknown flag ${f}`);
  const apply = flags.includes("--apply");
  stationIdentity()
    .then((station) =>
      projectAutodjEvents({
        apply,
        log: { info: console.log, warn: console.warn, error: console.error },
        timezone: station.timezone,
        now: new Date(),
      }),
    )
    .then((r) => {
      console.log(r.summary);
      if (!apply) console.log("\nDry run. Re-run with --apply to write to RadioDJ.");
    })
    .catch((err) => {
      console.error(err.message ?? err);
      process.exitCode = 1;
    })
    .finally(async () => {
      await pool.end();
      await closeScheduler();
    });
}
