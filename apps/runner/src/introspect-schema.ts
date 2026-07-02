import "dotenv/config";
import { writeFileSync } from "node:fs";
import { pool } from "./db.js";

// Tables the scheduler needs, per spec §4a. Names/pluralization may differ on the
// real rig — matched case-insensitively against what's actually there, never assumed.
const EXPECTED_TABLES: Record<string, string[]> = {
  songs: ["songs"],
  queuelist: ["queuelist"],
  history: ["history"],
  categories: ["categories", "category"],
  subcategory: ["subcategory", "subcategories"],
};

// Canonical field -> plausible actual-column aliases (case-insensitive). This is a
// starting guess to speed up matching, not a hardcoded assumption: every match is
// printed next to the full column list so a wrong guess is visible immediately, and
// anything unmatched is reported as MISSING rather than silently skipped.
//
// Note: `category_id` is deliberately not in this list. On RadioDJ v3's real schema,
// songs only carry `id_subcat` (subcategory) — category is one level up, resolved via
// `subcategory.parentid`. It's reported separately below, not as a per-song field.
const CANONICAL_ALIASES: Record<string, string[]> = {
  song_id: ["id", "songid", "song_id"],
  artist: ["artist"],
  title: ["title", "songtitle"],
  album: ["album"],
  path: ["path", "filename", "filepath"],
  duration: ["duration", "tag_time", "durationms"],
  subcategory_id: ["subcategory_id", "subcategoryid", "id_subcat"],
  genre_id: ["genre_id", "genreid", "id_genre"],
  weight: ["weight"],
  enabled: ["enabled"],
  song_type: ["song_type", "songtype", "type"],
  date_modified: ["date_modified", "datemodified", "modified"],
  date_added: ["date_added", "dateadded", "added"],
  date_played: ["date_played", "dateplayed", "lastplayed"],
  artist_played: ["artist_played", "artistplayed"],
  count_played: ["count_played", "countplayed", "playcount"],
  label: ["label"],
};

// Cue/marker fields are a bucket, not a single canonical name — collected separately.
const CUE_MARKER_PATTERN = /cue|marker|intro|outro|hook/i;

interface ColumnRow {
  TABLE_NAME: string;
  COLUMN_NAME: string;
  DATA_TYPE: string;
}

async function main() {
  const dbName = process.env.RADIODJ_DB_NAME;

  const [tableRows] = await pool.query<any[]>(
    "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ?",
    [dbName]
  );
  const allTables: string[] = tableRows.map((r) => r.TABLE_NAME);
  console.log(`\nFound ${allTables.length} tables in schema "${dbName}":`);
  console.log(allTables.join(", "));

  const matchedTables: Record<string, string> = {};
  for (const [expected, aliases] of Object.entries(EXPECTED_TABLES)) {
    const match = allTables.find((t) => aliases.includes(t.toLowerCase()));
    if (match) {
      matchedTables[expected] = match;
    } else {
      console.warn(
        `\nMISSING TABLE: no table matching "${expected}" found by exact case-insensitive ` +
          `name. Review the full table list above and identify it manually if it exists under a different name.`
      );
    }
  }

  const schemaMap: Record<string, unknown> = { tables: matchedTables, columns: {}, canonicalMap: {} };

  for (const [expected, actualTable] of Object.entries(matchedTables)) {
    const [colRows] = await pool.query<any[]>(
      "SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?",
      [dbName, actualTable]
    );
    const columns: ColumnRow[] = colRows as ColumnRow[];
    console.log(`\n--- ${expected} (table: ${actualTable}) — ${columns.length} columns ---`);
    for (const c of columns) {
      console.log(`  ${c.COLUMN_NAME} (${c.DATA_TYPE})`);
    }
    (schemaMap.columns as Record<string, string[]>)[expected] = columns.map((c) => c.COLUMN_NAME);
  }

  // Canonical map is only meaningful against the songs table for most fields.
  const songsColumns = ((schemaMap.columns as Record<string, string[]>)["songs"] ?? []).map((c) => ({
    original: c,
    lower: c.toLowerCase(),
  }));

  const canonicalMap: Record<string, string | null> = {};
  for (const [canonical, aliases] of Object.entries(CANONICAL_ALIASES)) {
    const found = songsColumns.find((c) => aliases.includes(c.lower));
    canonicalMap[canonical] = found ? found.original : null;
  }

  const cueMarkerColumns = songsColumns.filter((c) => CUE_MARKER_PATTERN.test(c.original)).map((c) => c.original);

  console.log("\n--- Canonical field map (songs) ---");
  const missing: string[] = [];
  for (const [canonical, actual] of Object.entries(canonicalMap)) {
    if (actual) {
      console.log(`  ${canonical} -> ${actual}`);
    } else {
      console.warn(`  MISSING: ${canonical} (no column matched — check the column list above manually)`);
      missing.push(canonical);
    }
  }
  console.log(`\nCue/marker columns found (bucket, not enumerated in spec): ${cueMarkerColumns.join(", ") || "(none found)"}`);

  // category_id isn't a songs column here — resolve it via subcategory.parentid instead.
  const subcategoryColumns = ((schemaMap.columns as Record<string, string[]>)["subcategory"] ?? []).map((c) =>
    c.toLowerCase()
  );
  const parentIdCol = subcategoryColumns.includes("parentid") ? "parentid" : null;
  console.log(
    parentIdCol
      ? `\ncategory_id: not on songs — derive via subcategory.${parentIdCol} (songs.${canonicalMap.subcategory_id} -> subcategory.ID -> subcategory.${parentIdCol} -> categories.ID)`
      : `\nMISSING: category_id derivation — subcategory table has no parentid-like column`
  );

  if (!parentIdCol) {
    missing.push("category_id (via subcategory.parentid)");
  }

  schemaMap.canonicalMap = canonicalMap;
  schemaMap.cueMarkerColumns = cueMarkerColumns;
  schemaMap.categoryDerivation = parentIdCol
    ? { via: "subcategory.parentid", subcategoryParentIdColumn: parentIdCol }
    : null;
  schemaMap.missing = missing;

  writeFileSync("schema-map.json", JSON.stringify(schemaMap, null, 2));
  console.log(`\nWrote schema-map.json (${missing.length} missing canonical field(s)).`);

  await pool.end();
  if (missing.length > 0) {
    console.error("\nSetup error: one or more canonical fields could not be located. Review schema-map.json.");
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
