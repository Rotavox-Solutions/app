import { readFileSync, existsSync } from "node:fs";

export interface SchemaMap {
  tables: Record<string, string>;
  columns: Record<string, string[]>;
  canonicalMap: Record<string, string | null>;
  cueMarkerColumns: string[];
  categoryDerivation: { via: string; subcategoryParentIdColumn: string } | null;
  missing: string[];
}

export function loadSchemaMap(): SchemaMap {
  if (!existsSync("schema-map.json")) {
    throw new Error("schema-map.json not found — run `npm run introspect` first (§4a).");
  }
  return JSON.parse(readFileSync("schema-map.json", "utf-8"));
}

export function requireCanonical(map: SchemaMap, field: string): string {
  const col = map.canonicalMap[field];
  if (!col) {
    throw new Error(`Canonical field "${field}" has no matched column in schema-map.json — rerun \`npm run introspect\`.`);
  }
  return col;
}

/** Case-insensitive lookup of a column within a given table's discovered column list. */
export function findColumn(map: SchemaMap, table: string, name: string): string | null {
  const columns = map.columns[table] ?? [];
  return columns.find((c) => c.toLowerCase() === name.toLowerCase()) ?? null;
}

// history isn't in the songs-focused canonicalMap (§10 leaves its exact watermark
// column an open item) — guessed heuristically from whatever columns introspection
// actually found, printed by callers so a wrong guess is visible.
export function guessHistoryColumns(map: SchemaMap): { pk: string; fk: string; ts: string } {
  const historyColumns = map.columns.history ?? [];
  const lower = historyColumns.map((c) => ({ original: c, lower: c.toLowerCase() }));
  const pk = lower.find((c) => c.lower === "id");
  // Prefer specific song-reference names first — a bare "id" is often the history
  // table's own primary key (e.g. RadioDJ's `history.ID` vs. its `history.trackID`),
  // so only fall back to it if nothing more specific is present.
  const fk =
    lower.find((c) => ["trackid", "songid", "song_id"].includes(c.lower)) ??
    lower.find((c) => c.lower === "id");
  const ts =
    lower.find((c) => /date|time/i.test(c.lower) && /play/i.test(c.lower)) ??
    lower.find((c) => /date|time/i.test(c.lower));
  if (!pk || !fk || !ts) {
    throw new Error(
      `Could not guess history table's id/song-id/timestamp columns from: ${historyColumns.join(", ")}. ` +
        `Inspect schema-map.json's "columns.history" manually.`
    );
  }
  return { pk: pk.original, fk: fk.original, ts: ts.original };
}
