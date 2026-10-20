import "dotenv/config";
import { and, eq } from "drizzle-orm";
import { importMembership, syncState } from "@rotavox/schema";
import { pgClient, schedulerDb, stationId } from "./scheduler-db.js";

/**
 * The one-time membership import (ADR-0002 §4): hands pool membership and lifecycle
 * state to Rotavox, translated from RadioDJ subcategories through the projection map the
 * format seed writes. Re-running it places only songs with no lifecycle history, which
 * makes it the intake path for songs added to RadioDJ since, until the Library screen
 * has an unassigned inbox.
 *
 * Postgres only — it reads the mirror, never RadioDJ. Run `sync-library` first, so the
 * mirror's subcategories are current. Dry run unless --apply.
 *
 *   npm run import-membership -w @rotavox/runner [-- --apply]
 */

const flags = process.argv.slice(2);
for (const f of flags) if (f !== "--apply") throw new Error(`Unknown flag ${f}`);
const apply = flags.includes("--apply");

async function main(): Promise<void> {
  const [sync] = await schedulerDb
    .select({ updatedAt: syncState.updatedAt })
    .from(syncState)
    .where(and(eq(syncState.stationId, stationId), eq(syncState.syncKey, "library_sync_run")));
  console.log(`Library last synced: ${sync ? sync.updatedAt.toISOString() : "unknown (no sync since this was recorded)"} — re-sync first if that is stale.`);

  const summary = await importMembership(schedulerDb, stationId, { dryRun: !apply });

  console.log(`\n${apply ? "Imported" : "Would import"} ${summary.imported} song(s)${summary.firstImport ? " (first import for this station)" : ""}:`);
  for (const [state, n] of Object.entries(summary.byState).sort()) console.log(`  ${state.padEnd(8)} ${n}`);
  if (summary.unassigned) {
    console.log(`  of which ${summary.unassigned} active with no pool — their RadioDJ subcategory is not in the projection map`);
  }
  console.log(`  ${summary.changed} changed an existing placement; the rest confirmed it.`);

  if (!apply) {
    console.log("\nDry run — nothing written. Re-run with --apply.");
  } else if (summary.firstImport) {
    console.log(
      "\nRotavox now owns membership for this station. refresh-memberships.sql will refuse to run, the " +
        "format seed will leave membership alone, and apply-changeset mirrors every move into Rotavox."
    );
  }
}

main()
  .catch((err) => {
    console.error(err.message ?? err);
    process.exitCode = 1;
  })
  .finally(() => pgClient.end());
