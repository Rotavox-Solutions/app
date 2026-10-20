import "dotenv/config";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { pool } from "./db.js";
import { mirrorChangesetMoves } from "@rotavox/schema";
import { pgClient, schedulerDb } from "./scheduler-db.js";
import { loadSchemaMap, requireCanonical } from "./schema-map.js";
import {
  validateShape,
  validateAgainstLive,
  invert,
  summarize,
  type Changeset,
  type LiveSong,
} from "./changeset.js";

/**
 * Applies a changeset to the live RadioDJ library (CHANGESET-CONTRACT.md §5).
 *
 * Validate-only by default. Writing requires an explicit --apply, because this is the
 * one code path in the system that mutates the broadcast library, and validation
 * succeeding must never be sufficient to cause a write.
 *
 * Per ADR-0001 §3.3 this is the Runner's writeback path: all column names come from
 * runtime introspection (invariant #1) and all RadioDJ contact stays in the Runner
 * (invariant #4).
 */

interface Args {
  file: string;
  apply: boolean;
  allowTagDrift: boolean;
  /** Skip RadioDJ entirely and only mirror the moves into Rotavox — recovery for a failed mirror. */
  mirrorOnly: boolean;
  outDir: string;
}

function parseArgs(argv: string[]): Args {
  const flags = new Set(argv.filter((a) => a.startsWith("--")));
  const positional = argv.filter((a) => !a.startsWith("--"));
  const file = positional[0];
  if (!file) {
    throw new Error(
      "usage: npm run apply-changeset -- <changeset.json> [--apply] [--allow-tag-drift] [--mirror-only]\n" +
        "       (validate-only unless --apply is given)"
    );
  }
  for (const f of flags) {
    if (!["--apply", "--allow-tag-drift", "--mirror-only"].includes(f)) throw new Error(`Unknown flag ${f}`);
  }
  return {
    file,
    apply: flags.has("--apply"),
    allowTagDrift: flags.has("--allow-tag-drift"),
    mirrorOnly: flags.has("--mirror-only"),
    outDir: path.resolve(path.dirname(file), ".."),
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const raw = JSON.parse(readFileSync(args.file, "utf-8"));
  const shapeErrors = validateShape(raw);
  if (shapeErrors.length) {
    console.error(`Changeset is malformed (${shapeErrors.length} error(s)):`);
    for (const e of shapeErrors) console.error(`  - ${e}`);
    process.exitCode = 1;
    return;
  }
  const cs = raw as Changeset;

  const expectedStation = process.env.STATION_ID;
  if (expectedStation && cs.station_id !== expectedStation) {
    console.error(
      `Changeset targets station ${cs.station_id} but this Runner serves ${expectedStation}.`
    );
    process.exitCode = 1;
    return;
  }

  if (args.mirrorOnly) {
    await mirrorIntoRotavox(cs);
    await pool.end();
    return;
  }

  const map = loadSchemaMap();
  const songsTable = map.tables.songs;
  const subcategoryTable = map.tables.subcategory;
  if (!songsTable || !subcategoryTable) {
    throw new Error("schema-map.json is missing the songs or subcategory table — rerun `npm run introspect`.");
  }
  const songIdCol = requireCanonical(map, "song_id");
  const artistCol = requireCanonical(map, "artist");
  const titleCol = requireCanonical(map, "title");
  const subcatCol = requireCanonical(map, "subcategory_id");
  const enabledCol = requireCanonical(map, "enabled");

  const ids = [
    ...(cs.moves ?? []).map((m) => m.rdj_song_id),
    ...(cs.set_enabled ?? []).map((m) => m.rdj_song_id),
    ...(cs.set_tags ?? []).map((m) => m.rdj_song_id),
  ];

  const [songRows] = await pool.query<any[]>(
    `SELECT \`${songIdCol}\` AS id, \`${artistCol}\` AS artist, \`${titleCol}\` AS title,
            \`${subcatCol}\` AS subcatId, \`${enabledCol}\` AS enabled
     FROM \`${songsTable}\` WHERE \`${songIdCol}\` IN (?)`,
    [ids]
  );
  const live = new Map<number, LiveSong>(
    songRows.map((r) => [
      Number(r.id),
      {
        rdjSongId: Number(r.id),
        artist: r.artist,
        title: r.title,
        subcatId: r.subcatId == null ? null : Number(r.subcatId),
        enabled: Boolean(r.enabled),
      },
    ])
  );

  const [subcatRows] = await pool.query<any[]>(`SELECT ID FROM \`${subcategoryTable}\``);
  const knownSubcats = new Set<number>(subcatRows.map((r) => Number(r.ID)));

  const { errors, warnings } = validateAgainstLive(cs, live, knownSubcats, {
    allowTagDrift: args.allowTagDrift,
  });

  for (const w of warnings) console.warn(`  warning: ${w}`);
  if (errors.length) {
    console.error(`\nPreconditions failed (${errors.length} error(s)) — nothing was written:`);
    for (const e of errors) console.error(`  - ${e}`);
    console.error(
      "\nA precondition failure means live has drifted from the sheet these decisions " +
        "were made on. Re-cut the sheet rather than editing the changeset to match."
    );
    process.exitCode = 1;
    await pool.end();
    return;
  }

  // ---- summary ----
  const moves = cs.moves ?? [];
  const setEnabled = cs.set_enabled ?? [];
  const setTags = cs.set_tags ?? [];
  console.log(`Changeset "${cs.id}" — ${cs.intent}`);
  console.log(`  authored ${cs.authored_at} from sheet ${cs.basis.sheet_id}`);
  console.log(
    `  ${moves.length} move(s), ${setEnabled.length} enable/disable change(s), ${setTags.length} tag correction(s)`
  );
  if (moves.length) {
    console.log("\n  net movement by subcategory:");
    for (const s of summarize(cs)) {
      const net = s.in - s.out;
      console.log(
        `    subcat ${String(s.subcatId).padStart(3)}: +${s.in} / -${s.out}  (net ${net >= 0 ? "+" : ""}${net})`
      );
    }
  }
  console.log(`\nAll preconditions passed against live RadioDJ.`);

  if (!args.apply) {
    console.log("\nValidate-only. Re-run with --apply to write these changes.");
    await pool.end();
    return;
  }

  // ---- inverse written BEFORE the transaction commits ----
  const inverseDir = path.join(args.outDir, "inverse");
  mkdirSync(inverseDir, { recursive: true });
  const inversePath = path.join(inverseDir, `${cs.id}.json`);
  writeFileSync(inversePath, JSON.stringify(invert(cs), null, 2) + "\n");
  console.log(`\nRollback artifact written: ${inversePath}`);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    for (const op of moves) {
      const [res] = await conn.query<any>(
        `UPDATE \`${songsTable}\` SET \`${subcatCol}\` = ? WHERE \`${songIdCol}\` = ? AND \`${subcatCol}\` = ?`,
        [op.to_subcat, op.rdj_song_id, op.from_subcat]
      );
      // The WHERE re-asserts the precondition inside the transaction, so a concurrent
      // edit between validation and commit aborts rather than silently overwriting.
      if (res.affectedRows !== 1) {
        throw new Error(
          `move for song ${op.rdj_song_id} affected ${res.affectedRows} rows — expected 1. Rolling back.`
        );
      }
    }
    for (const op of setEnabled) {
      const [res] = await conn.query<any>(
        `UPDATE \`${songsTable}\` SET \`${enabledCol}\` = ? WHERE \`${songIdCol}\` = ? AND \`${enabledCol}\` = ?`,
        [op.to_enabled ? 1 : 0, op.rdj_song_id, op.from_enabled ? 1 : 0]
      );
      if (res.affectedRows !== 1) {
        throw new Error(
          `enable change for song ${op.rdj_song_id} affected ${res.affectedRows} rows — expected 1. Rolling back.`
        );
      }
    }
    for (const op of setTags) {
      // BINARY makes the re-asserted precondition exact, matching validateAgainstLive:
      // under RadioDJ's case-insensitive collation a plain = would accept a row whose
      // tag was re-cased since the sheet.
      const [res] = await conn.query<any>(
        `UPDATE \`${songsTable}\` SET \`${artistCol}\` = ?, \`${titleCol}\` = ?
         WHERE \`${songIdCol}\` = ? AND BINARY \`${artistCol}\` = ? AND BINARY \`${titleCol}\` = ?`,
        [op.to_artist ?? op.artist, op.to_title ?? op.title, op.rdj_song_id, op.artist, op.title]
      );
      if (res.affectedRows !== 1) {
        throw new Error(
          `tag correction for song ${op.rdj_song_id} affected ${res.affectedRows} rows — expected 1. Rolling back.`
        );
      }
    }
    await conn.commit();
    console.log(
      `\nApplied ${moves.length + setEnabled.length + setTags.length} operation(s) in one transaction.`
    );
  } catch (err) {
    await conn.rollback();
    console.error("\nApply failed — transaction rolled back, library unchanged.");
    throw err;
  } finally {
    conn.release();
  }

  // ---- run record ----
  const appliedDir = path.join(args.outDir, "applied");
  mkdirSync(appliedDir, { recursive: true });
  const [[dbInfo]] = await pool.query<any[]>("SELECT DATABASE() AS db, NOW() AS now");
  writeFileSync(
    path.join(appliedDir, `${cs.id}.json`),
    JSON.stringify(
      {
        changeset_id: cs.id,
        sheet_id: cs.basis.sheet_id,
        applied_at: new Date(dbInfo.now).toISOString(),
        database: dbInfo.db,
        moves: moves.length,
        set_enabled: setEnabled.length,
        set_tags: setTags.length,
        tag_drift_allowed: args.allowTagDrift,
        inverse: path.relative(args.outDir, inversePath),
      },
      null,
      2
    ) + "\n"
  );

  await mirrorIntoRotavox(cs);
  console.log(
    "\nNext: re-sync the mirror (`npm run sync-library`) so it reflects RadioDJ's new subcategories" +
      " (and, for a station not yet imported, re-derive membership before generating any log)."
  );
  await pool.end();
}

/**
 * Mirrors the changeset's moves into Rotavox membership (ADR-0002 §4.3). Runs after the
 * RadioDJ commit, so the library is already changed if this fails — hence the explicit
 * recovery path rather than a silent warning.
 */
async function mirrorIntoRotavox(cs: Changeset): Promise<void> {
  const moves = (cs.moves ?? []).map((m) => ({ rdjSongId: m.rdj_song_id, toSubcat: m.to_subcat, reason: m.reason }));
  try {
    const result = await mirrorChangesetMoves(schedulerDb, cs.station_id, cs.id, moves);
    if (result.skipped) {
      console.log("\nRotavox membership not mirrored: this station is not imported yet, so membership is still derived.");
    } else {
      console.log(`\nMirrored into Rotavox: ${result.changed} song(s) changed pool or state.`);
      if (result.missing.length) {
        console.warn(
          `  warning: ${result.missing.length} song(s) are not in the Rotavox mirror yet ` +
            `(${result.missing.join(", ")}). Run sync-library, then import-membership --apply to place them.`
        );
      }
    }
  } catch (err) {
    console.error(
      `\nMIRROR FAILED — RadioDJ has the change but Rotavox membership does not: ${(err as Error).message}\n` +
        `Fix the cause, then re-run with --mirror-only. Do not generate a log until it succeeds.`
    );
    process.exitCode = 1;
  } finally {
    await pgClient.end();
  }
}

if (process.argv[1]?.endsWith("apply-changeset.ts")) {
  main().catch((err) => {
    console.error(err.message ?? err);
    process.exitCode = 1;
  });
}
