import type { EngineCategory, EnginePosition, EngineRule } from "./types.js";

// Two kinds of hard rules with different binding semantics:
//
// - Separation windows + tempo clash bind to the POSITION's pool ("when filling
//   from this category, keep these windows") — resolved per position with
//   global → category-ancestry → position precedence, narrowest scope winning.
//
// - max_per_hour + daypart_restrict bind to the CANDIDATE's category membership,
//   station-wide ("this category's songs, at most N per hour / only these hours"),
//   so they hold even when a song enters a slot via fallback from another pool.

export interface EffectiveRules {
  artistSepMin: number | null;
  titleSepMin: number | null;
  albumSepMin: number | null;
  tempoClashHard: { ruleId: string; maxJump: number } | null;
  /** rule ids backing each separation window, for violation payloads */
  ruleIds: { artist?: string; title?: string; album?: string };
}

export interface MaxPerHourConstraint {
  ruleId: string;
  categoryId: string;
  count: number;
  memberCategoryIds: Set<string>; // subtree of categoryId
}

export interface DaypartConstraint {
  ruleId: string;
  scope: "global" | "category" | "position";
  /** category subtree membership (category scope) or position id (position scope) */
  memberCategoryIds: Set<string> | null;
  positionId: string | null;
  days?: number[];
  hours?: number[];
}

export interface StationConstraints {
  maxPerHour: MaxPerHourConstraint[];
  dayparts: DaypartConstraint[];
}

export function buildCategoryIndex(categories: EngineCategory[]): Map<string, EngineCategory> {
  const m = new Map<string, EngineCategory>();
  for (const c of [...categories].sort((a, b) => a.id.localeCompare(b.id))) m.set(c.id, c);
  return m;
}

/** Category ancestry chain: [self, parent, ..., root]. Cycles tolerated (visited set). */
export function ancestry(categoryId: string, index: Map<string, EngineCategory>): string[] {
  const chain: string[] = [];
  const seen = new Set<string>();
  let cur: string | null = categoryId;
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    chain.push(cur);
    cur = index.get(cur)?.parentId ?? null;
  }
  return chain;
}

/** All descendants of a category (inclusive). */
export function subtree(rootId: string, categories: EngineCategory[]): Set<string> {
  const children = new Map<string, string[]>();
  for (const c of [...categories].sort((a, b) => a.id.localeCompare(b.id))) {
    if (c.parentId) {
      const list = children.get(c.parentId) ?? [];
      list.push(c.id);
      children.set(c.parentId, list);
    }
  }
  const out = new Set<string>();
  const queue = [rootId];
  while (queue.length) {
    const id = queue.shift()!;
    if (out.has(id)) continue;
    out.add(id);
    for (const child of children.get(id) ?? []) queue.push(child);
  }
  return out;
}

function minMinutes(rule: EngineRule): number | null {
  const v = rule.params?.["minMinutes"];
  return typeof v === "number" ? v : null;
}

export function resolveRules(
  rules: EngineRule[],
  position: EnginePosition,
  poolAncestry: string[] // [pool, parent, ..., root]
): EffectiveRules {
  const eff: EffectiveRules = {
    artistSepMin: null,
    titleSepMin: null,
    albumSepMin: null,
    tempoClashHard: null,
    ruleIds: {},
  };

  const sorted = [...rules].sort((a, b) => a.id.localeCompare(b.id));
  const layers: EngineRule[][] = [
    sorted.filter((r) => r.scope === "global"),
    // root → ... → pool, so closer-to-pool categories apply later and override
    ...[...poolAncestry].reverse().map((catId) => sorted.filter((r) => r.scope === "category" && r.scopeRef === catId)),
    sorted.filter((r) => r.scope === "position" && r.scopeRef === position.id),
  ];

  for (const layer of layers) {
    for (const rule of layer) {
      if (rule.hardness !== "hard") continue; // soft rules act through scoring weights
      switch (rule.ruleType) {
        case "artist_separation": {
          const m = minMinutes(rule);
          if (m != null) {
            eff.artistSepMin = m;
            eff.ruleIds.artist = rule.id;
          }
          break;
        }
        case "title_separation": {
          const m = minMinutes(rule);
          if (m != null) {
            eff.titleSepMin = m;
            eff.ruleIds.title = rule.id;
          }
          break;
        }
        case "album_separation": {
          const m = minMinutes(rule);
          if (m != null) {
            eff.albumSepMin = m;
            eff.ruleIds.album = rule.id;
          }
          break;
        }
        case "tempo_clash": {
          const j = rule.params?.["maxJump"];
          if (typeof j === "number") eff.tempoClashHard = { ruleId: rule.id, maxJump: j };
          break;
        }
      }
    }
  }
  return eff;
}

export function buildStationConstraints(
  rules: EngineRule[],
  categories: EngineCategory[]
): StationConstraints {
  const out: StationConstraints = { maxPerHour: [], dayparts: [] };
  for (const rule of [...rules].sort((a, b) => a.id.localeCompare(b.id))) {
    if (rule.hardness !== "hard") continue;
    if (rule.ruleType === "max_per_hour") {
      const count = rule.params?.["count"];
      if (typeof count === "number" && rule.scope === "category" && rule.scopeRef) {
        out.maxPerHour.push({
          ruleId: rule.id,
          categoryId: rule.scopeRef,
          count,
          memberCategoryIds: subtree(rule.scopeRef, categories),
        });
      }
    } else if (rule.ruleType === "daypart_restrict") {
      const days = rule.params?.["days"];
      const hours = rule.params?.["hours"];
      out.dayparts.push({
        ruleId: rule.id,
        scope: rule.scope,
        memberCategoryIds:
          rule.scope === "category" && rule.scopeRef ? subtree(rule.scopeRef, categories) : null,
        positionId: rule.scope === "position" ? rule.scopeRef : null,
        days: Array.isArray(days) ? (days as number[]) : undefined,
        hours: Array.isArray(hours) ? (hours as number[]) : undefined,
      });
    }
  }
  return out;
}
