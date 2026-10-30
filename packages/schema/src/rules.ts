// Editing the station's scheduling rules from the UI (ADR-0002: the UI owns format data).
// Only rules the engine enforces are offered (packages/engine/src/rules.ts): hard rules,
// scoped station-wide, to a category and the pools under it, or to one clock position,
// the narrowest scope winning. Soft rules are kept and shown, but the engine skips them —
// scoring weights come from engine config — so they are marked inactive, not editable.
//
// Saved whole like clocks and the grid: rules are updated in place by id, refused if
// someone else saved since loading, and snapshotted to rule_revisions. A save only changes
// logs generated after it.
import { and, count, eq, inArray, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "./schema.js";
import { categories, clockPositions, clocks, ruleRevisions, rules, stations } from "./schema.js";
import { ChangesetError } from "./changesets.js";

type Db = PostgresJsDatabase<typeof schema>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export type RuleScope = "global" | "category" | "position";

/** The hard rules the engine enforces, with their parameters and bounds. */
export const RULE_TYPES = {
  artist_separation: { label: "Artist separation", params: { minMinutes: [0, 10080] } },
  title_separation: { label: "Title separation", params: { minMinutes: [0, 10080] } },
  album_separation: { label: "Album separation", params: { minMinutes: [0, 10080] } },
  horizontal_separation: { label: "Horizontal separation", params: { windowHours: [1, 12], minDays: [1, 60] } },
  tempo_clash: { label: "Tempo clash", params: { maxJump: [0, 4] } },
  max_per_hour: { label: "Most per hour", params: { count: [0, 30] } },
  daypart_restrict: { label: "Only in these hours", params: {} },
} as const satisfies Record<string, { label: string; params: Record<string, readonly [number, number]> }>;
export type RuleType = keyof typeof RULE_TYPES;

/** Parameters as a PD reads them, for problems. */
const PARAM_NAMES: Record<string, string> = {
  minMinutes: "The minutes",
  windowHours: "The hour window",
  minDays: "The days",
  maxJump: "The tempo step",
  count: "The number per hour",
};
export const isEnforcedType = (t: string): t is RuleType => t in RULE_TYPES;

export interface RuleDraft {
  /** The rule's id, or null for one added in the editor. */
  id: string | null;
  key: string;
  ruleType: string;
  scope: RuleScope;
  /** A category id for category scope, a clock position id for position scope. */
  scopeRef: string | null;
  params: Record<string, unknown>;
  hardness: "hard" | "soft";
  weight: number | null;
}

export interface RulesForEdit {
  rules: RuleDraft[];
  updatedAt: Date;
}

const toDraft = (r: typeof rules.$inferSelect): RuleDraft => ({
  id: r.id,
  key: r.id,
  ruleType: r.ruleType,
  scope: r.scope as RuleScope,
  scopeRef: r.scopeRef,
  params: (r.params ?? {}) as Record<string, unknown>,
  hardness: r.hardness as "hard" | "soft",
  weight: r.weight,
});

export async function getRulesForEdit(db: Db, stationId: string): Promise<RulesForEdit | null> {
  const [station] = await db.select({ updatedAt: stations.rulesUpdatedAt }).from(stations).where(eq(stations.id, stationId));
  if (!station) return null;
  const rows = await db.select().from(rules).where(eq(rules.stationId, stationId));
  return {
    updatedAt: station.updatedAt,
    rules: rows
      .map(toDraft)
      .sort((a, b) => a.ruleType.localeCompare(b.ruleType) || a.scope.localeCompare(b.scope) || a.key.localeCompare(b.key)),
  };
}

/** A clock position, named the way the rules screen shows it: "ES #4". */
export interface PositionLabel {
  id: string;
  label: string;
}

export async function getPositionLabels(db: Db | Tx, stationId: string, ids: string[]): Promise<PositionLabel[]> {
  if (ids.length === 0) return [];
  const rows = await db
    .select({ id: clockPositions.id, clock: clocks.name, n: clockPositions.sortOrder })
    .from(clockPositions)
    .innerJoin(clocks, eq(clocks.id, clockPositions.clockId))
    .where(and(eq(clocks.stationId, stationId), inArray(clockPositions.id, ids)));
  return rows.map((r) => ({ id: r.id, label: `${r.clock} #${r.n}` }));
}

const isWhole = (v: unknown, min: number, max: number) =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
const isList = (v: unknown, min: number, max: number) =>
  Array.isArray(v) && v.length > 0 && v.every((x) => isWhole(x, min, max)) && new Set(v).size === v.length;

export class RulesSaveError extends ChangesetError {
  constructor(message: string, public problems: string[] = []) {
    super("invalid", message);
  }
}

/** Problems with a set of rules, each naming the rule; empty means it can be saved. */
export async function validateRules(db: Db | Tx, stationId: string, drafts: RuleDraft[]): Promise<string[]> {
  if (!Array.isArray(drafts)) return ["Send the rules."];
  const problems: string[] = [];
  const cats = await db.select({ id: categories.id, name: categories.name }).from(categories).where(eq(categories.stationId, stationId));
  const catName = new Map(cats.map((c) => [c.id, c.name]));
  const positionIds = drafts.filter((d) => d.scope === "position" && d.scopeRef).map((d) => d.scopeRef!);
  const positions = new Set((await getPositionLabels(db, stationId, positionIds)).map((p) => p.id));
  const seen = new Map<string, string>();

  for (const d of drafts) {
    // Soft rules and types the engine doesn't know are carried through as they are.
    if (d.hardness !== "hard" || !isEnforcedType(d.ruleType)) continue;
    const def = RULE_TYPES[d.ruleType];
    const where =
      d.scope === "global" ? "station-wide" : d.scope === "category" ? `for ${catName.get(d.scopeRef ?? "") ?? "a category"}` : "on a clock position";
    const name = `${def.label} ${where}`;

    if (d.scope === "category" && !catName.has(d.scopeRef ?? "")) problems.push(`${def.label}: choose a category at this station.`);
    else if (d.scope === "position" && !positions.has(d.scopeRef ?? "")) problems.push(`${def.label}: its clock position no longer exists.`);
    else if (d.scope !== "global" && d.scope !== "category" && d.scope !== "position") problems.push(`${def.label}: unknown scope.`);
    if (d.scope === "global" && d.ruleType === "max_per_hour") problems.push(`${name}: choose the category it limits.`);

    for (const [param, [min, max]] of Object.entries(def.params) as [string, readonly [number, number]][]) {
      if (!isWhole(d.params?.[param], min, max)) problems.push(`${name}: ${(PARAM_NAMES[param] ?? param).toLowerCase()} must be a whole number, ${min} to ${max}.`);
    }
    if (d.ruleType === "daypart_restrict") {
      const { days, hours } = d.params ?? {};
      if (days === undefined && hours === undefined) problems.push(`${name}: choose days, hours or both.`);
      if (days !== undefined && !isList(days, 0, 6)) problems.push(`${name}: choose at least one day.`);
      if (hours !== undefined && !isList(hours, 0, 23)) problems.push(`${name}: choose at least one hour.`);
    }

    // The engine lets the later of two same-scope rules win arbitrarily; refuse the pair.
    const slot = `${d.ruleType}|${d.scope}|${d.scopeRef ?? ""}`;
    if (seen.has(slot)) problems.push(`${name} is set twice; keep one.`);
    seen.set(slot, d.key);
  }
  return [...new Set(problems)];
}

export interface RulesSnapshot {
  rules: Omit<RuleDraft, "id" | "key">[];
}

const snapshotOf = (drafts: RuleDraft[]): RulesSnapshot => ({
  rules: drafts.map(({ id: _id, key: _key, ...r }) => r),
});

export async function saveRules(
  db: Db,
  stationId: string,
  drafts: RuleDraft[],
  opts: { expectedUpdatedAt: Date; userId: string | null; note?: string | null; now?: Date }
): Promise<{ updatedAt: Date; added: number; removed: number }> {
  const now = opts.now ?? new Date();
  return db.transaction(async (tx) => {
    const [station] = await tx
      .select({ updatedAt: stations.rulesUpdatedAt })
      .from(stations)
      .where(eq(stations.id, stationId))
      .for("update");
    if (!station) throw new ChangesetError("not_found", "No such station.");
    if (station.updatedAt.getTime() !== new Date(opts.expectedUpdatedAt).getTime()) {
      throw new ChangesetError(
        "conflict",
        "The rules were saved by someone else since you opened them. Reload to see their version, then make your change again."
      );
    }
    const existing = await tx.select().from(rules).where(eq(rules.stationId, stationId));
    const existingIds = new Set(existing.map((r) => r.id));
    const problems = await validateRules(tx, stationId, drafts);
    if (drafts.some((d) => d.id && !existingIds.has(d.id))) problems.push("A rule belongs to another station; reload the editor.");
    if (problems.length) throw new RulesSaveError(problems[0], problems);

    const [{ n: revisions }] = await tx.select({ n: count() }).from(ruleRevisions).where(eq(ruleRevisions.stationId, stationId));
    if (revisions === 0) {
      await tx.insert(ruleRevisions).values({
        stationId,
        snapshot: snapshotOf(existing.map(toDraft)),
        note: "As they stood before the first edit in Rotavox",
        savedAt: station.updatedAt,
      });
    }

    const keep = new Set(drafts.map((d) => d.id).filter((id): id is string => !!id));
    const removed = existing.filter((r) => !keep.has(r.id)).map((r) => r.id);
    if (removed.length) await tx.delete(rules).where(inArray(rules.id, removed));
    let added = 0;
    for (const d of drafts) {
      const values = {
        ruleType: d.ruleType,
        scope: d.scope,
        scopeRef: d.scope === "global" ? null : d.scopeRef,
        params: d.params ?? {},
        hardness: d.hardness,
        weight: d.weight,
      };
      if (d.id) await tx.update(rules).set(values).where(eq(rules.id, d.id));
      else {
        await tx.insert(rules).values({ stationId, ...values });
        added++;
      }
    }
    await tx.update(stations).set({ rulesUpdatedAt: now }).where(eq(stations.id, stationId));
    await tx.insert(ruleRevisions).values({
      stationId,
      snapshot: snapshotOf(drafts),
      note: opts.note?.trim() || null,
      savedBy: opts.userId,
      savedAt: now,
    });
    return { updatedAt: now, added, removed: removed.length };
  });
}

export interface RuleRevisionRow {
  id: string;
  savedAt: Date;
  note: string | null;
  savedByName: string | null;
  snapshot: RulesSnapshot;
}

export async function listRuleRevisions(db: Db, stationId: string): Promise<RuleRevisionRow[]> {
  const rows = await db
    .select({
      id: ruleRevisions.id,
      savedAt: ruleRevisions.savedAt,
      note: ruleRevisions.note,
      savedByName: schema.users.name,
      snapshot: ruleRevisions.snapshot,
    })
    .from(ruleRevisions)
    .leftJoin(schema.users, eq(schema.users.id, ruleRevisions.savedBy))
    .where(eq(ruleRevisions.stationId, stationId))
    .orderBy(sql`${ruleRevisions.savedAt} desc`)
    .limit(50);
  return rows.map((r) => ({ ...r, snapshot: r.snapshot as RulesSnapshot }));
}
