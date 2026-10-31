// Station-level settings edited from Station › Settings. The rotation lives with the grid
// (grid.ts setRotation), since it changes what the grid means.
import { and, eq, isNull, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "./schema.js";
import { runnerKeys, songs, stations } from "./schema.js";
import { ChangesetError } from "./changesets.js";

type Db = PostgresJsDatabase<typeof schema>;

/** Renames the station. Its name shows across Rotavox and in Runner and staff screens. */
export async function setStationName(db: Db, stationId: string, name: string): Promise<void> {
  const clean = (name ?? "").trim();
  if (!clean) throw new ChangesetError("invalid", "Give the station a name.");
  if (clean.length > 60) throw new ChangesetError("invalid", "Keep the name to 60 characters.");
  const updated = await db.update(stations).set({ name: clean }).where(eq(stations.id, stationId)).returning({ id: stations.id });
  if (updated.length === 0) throw new ChangesetError("not_found", "No such station.");
}

export type Playout = "radiodj" | "file";
export const PLAYOUTS: readonly Playout[] = ["radiodj", "file"];

/** True when the IANA zone is one this runtime knows; the engine and every page format in it. */
export function isTimeZone(tz: string): boolean {
  if (!tz || !tz.includes("/")) return tz === "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Creates a station (Rotavox staff only). A 'file' station is adapter tier 0 from the start
 * (ADR-0001 §3.5c): no as-played feed, so approved logs count as aired; and no RadioDJ
 * subcategories to derive pools from, so Rotavox owns membership from day one. A 'radiodj'
 * station waits for its Runner's first library sync and the one-time pool import.
 */
export async function createStation(
  db: Db,
  opts: { name: string; timezone: string; playout: Playout; now?: Date },
): Promise<{ id: string; name: string }> {
  const name = (opts.name ?? "").trim();
  if (!name) throw new ChangesetError("invalid", "Give the station a name.");
  if (name.length > 60) throw new ChangesetError("invalid", "Keep the name to 60 characters.");
  if (!isTimeZone(opts.timezone)) throw new ChangesetError("invalid", "Choose the station's time zone.");
  if (!PLAYOUTS.includes(opts.playout)) throw new ChangesetError("invalid", "Choose how logs reach air.");
  const file = opts.playout === "file";
  const [row] = await db
    .insert(stations)
    .values({
      name,
      timezone: opts.timezone,
      playout: opts.playout,
      assumeLogAired: file,
      membershipImportedAt: file ? opts.now ?? new Date() : null,
    })
    .returning({ id: stations.id, name: stations.name });
  return row;
}

/**
 * Changes how a station's logs reach air (Rotavox staff only).
 *
 * To 'file': only with no live Runner key, since a connected Runner would keep syncing the
 * library and pacing logs. Approved logs count as aired from then on, and Rotavox takes
 * over the pools as they stand if it didn't own them already.
 *
 * To 'radiodj': only while the station has no songs. The Runner's sync matches songs by
 * RadioDJ song number, and imported songs carry numbers from another system or assigned
 * by Rotavox: the sync would overwrite them with unrelated RadioDJ songs, mixing up their
 * pools and play history. With nothing to collide with, the station starts like any
 * RadioDJ station: the Runner syncs the library, then the one-time pool import.
 */
export async function setPlayout(db: Db, stationId: string, playout: Playout, now: Date = new Date()): Promise<void> {
  if (!PLAYOUTS.includes(playout)) throw new ChangesetError("invalid", "Choose how logs reach air.");
  const [station] = await db.select().from(stations).where(eq(stations.id, stationId));
  if (!station) throw new ChangesetError("not_found", "No such station.");
  if (station.playout === playout) return;

  if (playout === "file") {
    const [key] = await db
      .select({ id: runnerKeys.id })
      .from(runnerKeys)
      .where(and(eq(runnerKeys.stationId, stationId), isNull(runnerKeys.revokedAt)))
      .limit(1);
    if (key) {
      throw new ChangesetError(
        "invalid",
        "Revoke the Runner's key on the Station page first: a connected Runner would keep syncing the library and pacing logs into RadioDJ."
      );
    }
    await db
      .update(stations)
      .set({ playout, assumeLogAired: true, membershipImportedAt: station.membershipImportedAt ?? now })
      .where(eq(stations.id, stationId));
    return;
  }

  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(songs).where(eq(songs.stationId, stationId));
  if (count > 0) {
    throw new ChangesetError(
      "invalid",
      `This station has ${count === 1 ? "a song" : `${count.toLocaleString("en-US")} songs`} from file imports. RadioDJ's library sync matches songs by RadioDJ's song numbers, which imported songs don't carry, so it would overwrite them with unrelated songs. Only a station with no library yet can move to RadioDJ.`
    );
  }
  await db.update(stations).set({ playout, assumeLogAired: false, membershipImportedAt: null }).where(eq(stations.id, stationId));
}
