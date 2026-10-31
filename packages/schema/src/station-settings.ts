// Station-level settings edited from Station › Settings. The rotation lives with the grid
// (grid.ts setRotation), since it changes what the grid means.
import { eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "./schema.js";
import { stations } from "./schema.js";
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
