import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { listPendingProjections, loadProjection, markProjection, songs } from "@rotavox/schema";
import { pool } from "./db.js";
import { pgClient, schedulerDb, stationId } from "./scheduler-db.js";
import { applyToRadioDJ } from "./apply-changeset.js";
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
 *   npm run project-changesets -w @rotavox/runner [-- --apply]
 *
 * Validate-only unless --apply: this writes the live broadcast library.
 */

const flags = process.argv.slice(2);
for (const f of flags) if (f !== "--apply") throw new Error(`Unknown flag ${f}`);
const apply = flags.includes("--apply");
const changesetsDir = path.resolve(import.meta.dirname, "../../../changesets");

async function main(): Promise<void> {
  const pending = await listPendingProjections(schedulerDb, stationId);
  if (pending.length === 0) {
    console.log("Nothing to project: every applied change is already in RadioDJ.");
    return;
  }
  const { cats, lifecycle } = await loadProjection(schedulerDb, stationId);
  console.log(`${pending.length} changeset(s) applied in Rotavox and not yet in RadioDJ.\n`);

  for (const p of pending) {
    console.log(`— ${p.intent} (${p.items.length} song(s), applied ${p.appliedAt?.toISOString()})`);
    const plan = planProjection(p, stationId, cats, lifecycle);
    if (plan.errors.length) {
      for (const e of plan.errors) console.error(`  - ${e}`);
      if (apply) await markProjection(schedulerDb, p.id, { ok: false, error: plan.errors.join("; ") });
      console.error("  Cannot project this changeset. Stopping here: later changes may depend on it.");
      process.exitCode = 1;
      return;
    }
    if (!plan.changeset) {
      console.log("  RadioDJ already matches — no subcategory changes needed.");
      if (apply) await markProjection(schedulerDb, p.id, { ok: true });
      continue;
    }
    const shape = validateShape(plan.changeset);
    if (shape.length) throw new Error(`generated changeset is malformed: ${shape.join("; ")}`);

    const file = path.join(changesetsDir, "rotavox", `${plan.changeset.id}.json`);
    if (apply) {
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, JSON.stringify(plan.changeset, null, 2) + "\n");
      console.log(`  Changeset file: ${file}`);
    }
    let written: boolean;
    try {
      written = await applyToRadioDJ(plan.changeset, { apply, allowTagDrift: false, outDir: changesetsDir });
    } catch (err) {
      if (apply) await markProjection(schedulerDb, p.id, { ok: false, error: (err as Error).message });
      throw err;
    }
    if (!written) {
      if (apply) {
        await markProjection(schedulerDb, p.id, { ok: false, error: "preconditions failed against live RadioDJ" });
        console.error("  Stopping here: later changes may depend on this one.");
      }
      if (process.exitCode) return;
      continue; // validate-only: keep showing what each one would do
    }

    // Keep the mirror's subcategory current, so the next changeset's precondition is right
    // without waiting for a sync. sync-library would repair it anyway.
    for (const m of plan.changeset.moves ?? []) {
      await schedulerDb
        .update(songs)
        .set({ rdjSubcategoryId: m.to_subcat })
        .where(and(eq(songs.stationId, stationId), eq(songs.rdjSongId, m.rdj_song_id)));
    }
    await markProjection(schedulerDb, p.id, { ok: true });
    console.log("  Written to RadioDJ.\n");
  }
  if (!apply) console.log("\nValidate-only. Re-run with --apply to write to RadioDJ.");
}

main()
  .catch((err) => {
    console.error(err.message ?? err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
    await pgClient.end();
  });
