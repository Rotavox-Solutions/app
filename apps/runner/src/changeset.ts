// Changeset parsing, validation, and inversion — pure, no I/O, per CHANGESET-CONTRACT.md v1.
// Kept free of DB access so the rules that decide whether a live library gets written
// to are unit-testable without a live library.

export interface Move {
  rdj_song_id: number;
  artist: string;
  title: string;
  from_subcat: number;
  to_subcat: number;
  reason: string;
}

export interface SetEnabled {
  rdj_song_id: number;
  artist: string;
  title: string;
  from_enabled: boolean;
  to_enabled: boolean;
  reason: string;
}

export interface Changeset {
  changeset_version: 1;
  id: string;
  station_id: string;
  authored_at: string;
  intent: string;
  basis: { sheet_id: string; sheet_captured_at?: string };
  moves?: Move[];
  set_enabled?: SetEnabled[];
}

/** A song as it currently exists in RadioDJ, for precondition checking. */
export interface LiveSong {
  rdjSongId: number;
  artist: string | null;
  title: string | null;
  subcatId: number | null;
  enabled: boolean;
}

const TOP_LEVEL_KEYS = new Set([
  "changeset_version",
  "id",
  "station_id",
  "authored_at",
  "intent",
  "basis",
  "moves",
  "set_enabled",
]);

const MOVE_KEYS = new Set(["rdj_song_id", "artist", "title", "from_subcat", "to_subcat", "reason"]);
const ENABLED_KEYS = new Set([
  "rdj_song_id",
  "artist",
  "title",
  "from_enabled",
  "to_enabled",
  "reason",
]);

/**
 * Tag comparison normalizer. Case- and whitespace-insensitive because RadioDJ's own
 * data contains embedded tabs and doubled spaces (one live ZN title carries a literal
 * tab), and a sheet that renders cleanly would otherwise fail a byte-equality check
 * against the row it was generated from.
 */
export function normalizeTag(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Structural validation — everything checkable without touching the database.
 * Returns a list of human-readable errors; empty means the file is well-formed.
 */
export function validateShape(raw: unknown): string[] {
  const errors: string[] = [];
  if (!isPlainObject(raw)) return ["Changeset must be a JSON object."];

  // Unknown keys are rejected, never ignored: a v2 file must fail loudly against a v1
  // applier rather than silently applying the subset it happens to understand.
  for (const key of Object.keys(raw)) {
    if (!TOP_LEVEL_KEYS.has(key)) errors.push(`Unknown top-level key "${key}".`);
  }

  if (raw.changeset_version !== 1) {
    errors.push(`changeset_version must be 1 (got ${JSON.stringify(raw.changeset_version)}).`);
  }
  for (const field of ["id", "station_id", "authored_at", "intent"] as const) {
    if (typeof raw[field] !== "string" || !(raw[field] as string).trim()) {
      errors.push(`${field} is required and must be a non-empty string.`);
    }
  }
  if (!isPlainObject(raw.basis) || typeof raw.basis.sheet_id !== "string" || !raw.basis.sheet_id.trim()) {
    errors.push("basis.sheet_id is required — a changeset must name the sheet it was authored from.");
  }

  const moves = raw.moves ?? [];
  const setEnabled = raw.set_enabled ?? [];
  if (!Array.isArray(moves)) errors.push("moves must be an array if present.");
  if (!Array.isArray(setEnabled)) errors.push("set_enabled must be an array if present.");
  if (!Array.isArray(moves) || !Array.isArray(setEnabled)) return errors;

  if (moves.length === 0 && setEnabled.length === 0) {
    errors.push("Changeset contains no operations.");
  }

  const seen = new Map<number, string>();
  const checkCommon = (op: Record<string, unknown>, label: string, allowed: Set<string>) => {
    for (const key of Object.keys(op)) {
      if (!allowed.has(key)) errors.push(`${label}: unknown key "${key}".`);
    }
    if (typeof op.rdj_song_id !== "number" || !Number.isInteger(op.rdj_song_id)) {
      errors.push(`${label}: rdj_song_id must be an integer.`);
      return false;
    }
    for (const field of ["artist", "title"] as const) {
      if (typeof op[field] !== "string") errors.push(`${label}: ${field} must be a string.`);
    }
    if (typeof op.reason !== "string" || !op.reason.trim()) {
      errors.push(`${label}: reason is required and must be non-empty.`);
    }
    // One song, one decision — two operations on the same song in one changeset means
    // the intent is ambiguous and the inverse would not be well-defined.
    const prior = seen.get(op.rdj_song_id);
    if (prior) {
      errors.push(`${label}: rdj_song_id ${op.rdj_song_id} already appears in ${prior}.`);
    } else {
      seen.set(op.rdj_song_id, label);
    }
    return true;
  };

  moves.forEach((op: unknown, i: number) => {
    const label = `moves[${i}]`;
    if (!isPlainObject(op)) return void errors.push(`${label}: must be an object.`);
    if (!checkCommon(op, label, MOVE_KEYS)) return;
    for (const field of ["from_subcat", "to_subcat"] as const) {
      if (typeof op[field] !== "number" || !Number.isInteger(op[field])) {
        errors.push(`${label}: ${field} must be an integer.`);
      }
    }
    if (op.from_subcat === op.to_subcat) {
      errors.push(`${label}: from_subcat equals to_subcat (${op.from_subcat}) — no-op.`);
    }
  });

  setEnabled.forEach((op: unknown, i: number) => {
    const label = `set_enabled[${i}]`;
    if (!isPlainObject(op)) return void errors.push(`${label}: must be an object.`);
    if (!checkCommon(op, label, ENABLED_KEYS)) return;
    for (const field of ["from_enabled", "to_enabled"] as const) {
      if (typeof op[field] !== "boolean") errors.push(`${label}: ${field} must be a boolean.`);
    }
    if (op.from_enabled === op.to_enabled) {
      errors.push(`${label}: from_enabled equals to_enabled — no-op.`);
    }
  });

  return errors;
}

export interface LiveCheckOptions {
  /** Downgrade artist/title mismatches to warnings (tags legitimately corrected since the sheet). */
  allowTagDrift?: boolean;
}

export interface LiveCheckResult {
  errors: string[];
  warnings: string[];
}

/**
 * Precondition validation against live state. Any failure here aborts the entire
 * changeset — a stale precondition means the sheet the decisions were made from no
 * longer describes the library, so every row is suspect, not just the mismatched one.
 */
export function validateAgainstLive(
  cs: Changeset,
  live: Map<number, LiveSong>,
  knownSubcatIds: Set<number>,
  opts: LiveCheckOptions = {}
): LiveCheckResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const checkIdentity = (
    op: { rdj_song_id: number; artist: string; title: string },
    label: string
  ): LiveSong | null => {
    const row = live.get(op.rdj_song_id);
    if (!row) {
      errors.push(`${label}: song ${op.rdj_song_id} does not exist in RadioDJ.`);
      return null;
    }
    for (const [field, expected, actual] of [
      ["artist", op.artist, row.artist],
      ["title", op.title, row.title],
    ] as const) {
      if (normalizeTag(expected) !== normalizeTag(actual)) {
        const msg = `${label}: ${field} mismatch on song ${op.rdj_song_id} — changeset says ${JSON.stringify(expected)}, live says ${JSON.stringify(actual)}.`;
        if (opts.allowTagDrift) warnings.push(msg);
        else errors.push(`${msg} (pass --allow-tag-drift if the tag was corrected since the sheet)`);
      }
    }
    return row;
  };

  (cs.moves ?? []).forEach((op, i) => {
    const label = `moves[${i}]`;
    const row = checkIdentity(op, label);
    if (!row) return;
    if (row.subcatId !== op.from_subcat) {
      errors.push(
        `${label}: song ${op.rdj_song_id} is in subcategory ${row.subcatId}, changeset expected ${op.from_subcat} — live has drifted since the sheet was captured.`
      );
    }
    if (!knownSubcatIds.has(op.to_subcat)) {
      errors.push(`${label}: target subcategory ${op.to_subcat} does not exist.`);
    }
  });

  (cs.set_enabled ?? []).forEach((op, i) => {
    const label = `set_enabled[${i}]`;
    const row = checkIdentity(op, label);
    if (!row) return;
    if (row.enabled !== op.from_enabled) {
      errors.push(
        `${label}: song ${op.rdj_song_id} has enabled=${row.enabled}, changeset expected ${op.from_enabled} — live has drifted since the sheet was captured.`
      );
    }
  });

  return { errors, warnings };
}

/**
 * The inverse changeset — the rollback artifact. Derivable purely from the changeset
 * because every operation carries its `from` state, which is why that field is
 * mandatory rather than merely useful.
 */
export function invert(cs: Changeset): Changeset {
  return {
    changeset_version: 1,
    id: `${cs.id}-inverse`,
    station_id: cs.station_id,
    authored_at: cs.authored_at,
    intent: `Inverse of "${cs.id}". Restores the state that changeset replaced.`,
    basis: cs.basis,
    moves: (cs.moves ?? []).map((op) => ({
      ...op,
      from_subcat: op.to_subcat,
      to_subcat: op.from_subcat,
      reason: `Rollback of: ${op.reason}`,
    })),
    set_enabled: (cs.set_enabled ?? []).map((op) => ({
      ...op,
      from_enabled: op.to_enabled,
      to_enabled: op.from_enabled,
      reason: `Rollback of: ${op.reason}`,
    })),
  };
}

/** Net per-subcategory movement, for the pre-apply summary. */
export function summarize(cs: Changeset): { subcatId: number; in: number; out: number }[] {
  const net = new Map<number, { in: number; out: number }>();
  const bucket = (id: number) => {
    if (!net.has(id)) net.set(id, { in: 0, out: 0 });
    return net.get(id)!;
  };
  for (const op of cs.moves ?? []) {
    bucket(op.to_subcat).in += 1;
    bucket(op.from_subcat).out += 1;
  }
  return [...net.entries()]
    .map(([subcatId, v]) => ({ subcatId, ...v }))
    .sort((a, b) => b.in - b.out - (a.in - a.out));
}
