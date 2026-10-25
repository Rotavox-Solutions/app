import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { listPendingProjections, loadProjection, markProjection, songs } from "@rotavox/schema";
import { pool } from "./db.js";
import { pgClient, schedulerDb, stationId } from "./scheduler-db.js";
import { applyToRadioDJ, type ApplyLog } from "./apply-changeset.js";
import { validateShape } from "./changeset.js";
import { planProjection } from "./projection.js";

/**
 * Writes changesets applied in Rotavox to RadioDJ (ADR-0002 §2.3) — the projection that
 * keeps RadioDJ's own subcategories, and so AutoDJ's fallback rotations, in step with the
 * pools Rotavox now owns.
 *
 * Each one becomes a v1 changeset file under changesets/rotavox/ and goes through the same
 * validated path as a hand-authored one: live preconditions, one transaction, an inverse
 * written first. Oldest first, stopping at the first failure, since a later change may
 * build on an earlier one.
 *
 * The Runner runs this as a job when a PD applies a change in the UI; applying is the
 * operator confirmation the contract asks for. The CLI form is for engineers:
 *
 *   npm run project-changesets -w @rotavox/runner [-- --apply]
 */

const changesetsDir = path.resolve(import.meta.dirname, "../../../changesets");

export interface ProjectResult {
  /** Changesets now in RadioDJ, including ones that needed no subcategory change. */
  projected: number;
  /** Why projection stopped, if it did. Null when everything pending went through. */
  stopped: string | null;
}

export async function projectChangesets(opts: { apply: boolean; log: ApplyLog }): Promise<ProjectResult> {
  const { apply, log } = opts;
  const pending = await listPendingProjections(schedulerDb, stationId);
  if (pending.length === 0) {
    log.info("Nothing to write: every applied change is already in RadioDJ.");
    return { projected: 0, stopped: null };
  }
  const { cats, lifecycle } = await loadProjection(schedulerDb, stationId);
  log.info(`${pending.length} changeset(s) applied in Rotavox and not yet in RadioDJ.`);

  let projected = 0;
  const fail = async (id: string, reason: string): Promise<ProjectResult> => {
    if (apply) await markProjection(schedulerDb, id, { ok: false, error: reason });
    log.error(`  Stopped: ${reason}. Later changes wait behind this one, since they may depend on it.`);
    return { projected, stopped: reason };
  };

  for (const p of pending) {
    log.info(`\n— ${p.intent} (${p.items.length} song(s), applied ${p.appliedAt?.toISOString()})`);
    const plan = planProjection(p, stationId, cats, lifecycle);
    if (plan.errors.length) {
      for (const e of plan.errors) log.error(`  - ${e}`);
      return fail(p.id, plan.errors.join("; "));
    }
    if (!plan.changeset) {
      log.info("  RadioDJ already matches — no subcategory changes needed.");
      if (apply) await markProjection(schedulerDb, p.id, { ok: true });
      projected++;
      continue;
    }
    const shape = validateShape(plan.changeset);
    if (shape.length) throw new Error(`generated changeset is malformed: ${shape.join("; ")}`);

    if (apply) {
      const file = path.join(changesetsDir, "rotavox", `${plan.changeset.id}.json`);
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, JSON.stringify(plan.changeset, null, 2) + "\n");
      log.info(`  Changeset file: ${file}`);
    }
    let outcome;
    try {
      outcome = await applyToRadioDJ(plan.changeset, { apply, allowTagDrift: false, outDir: changesetsDir, log });
    } catch (err) {
      return fail(p.id, (err as Error).message);
    }
    if (outcome === "rejected") {
      return fail(p.id, "RadioDJ was changed directly for some of these songs since Rotavox last synced");
    }
    if (outcome === "validated") continue; // dry run: keep showing what each would do

    // Keep the mirror's subcategory current, so the next changeset's precondition is right
    // without waiting for a sync. sync-library would repair it anyway.
    for (const m of plan.changeset.moves ?? []) {
      await schedulerDb
        .update(songs)
        .set({ rdjSubcategoryId: m.to_subcat })
        .where(and(eq(songs.stationId, stationId), eq(songs.rdjSongId, m.rdj_song_id)));
    }
    await markProjection(schedulerDb, p.id, { ok: true });
    projected++;
    log.info("  Written to RadioDJ.");
  }
  return { projected, stopped: null };
}

if (process.argv[1]?.endsWith("project-changesets.ts")) {
  const flags = process.argv.slice(2);
  for (const f of flags) if (f !== "--apply") throw new Error(`Unknown flag ${f}`);
  const apply = flags.includes("--apply");
  projectChangesets({ apply, log: { info: console.log, warn: console.warn, error: console.error } })
    .then((r) => {
      if (r.stopped) process.exitCode = 1;
      if (!apply) console.log("\nValidate-only. Re-run with --apply to write to RadioDJ.");
    })
    .catch((err) => {
      console.error(err.message ?? err);
      process.exitCode = 1;
    })
    .finally(async () => {
      await pool.end();
      await pgClient.end();
    });
}
