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
