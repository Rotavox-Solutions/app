// Engine-owned input/output types. Deliberately independent of @rotavox/schema —
// the loader (apps/runner) maps DB rows into these, keeping the engine pure and
// fixture-testable with zero runtime dependencies.

export interface EngineSong {
  /** Scheduler uuid (songs.id) — null in fixtures that don't care. */
  id: string;
  rdjSongId: number;
  artist: string | null;
  title: string | null;
  album: string | null;
  durationMs: number | null;
  songType: number | null;
  /** Scheduler category membership, pre-resolved from song_categories by the loader. */
  categoryIds: string[];
  era: string | null;
  tempo: number | null;
  energy: number | null;
  mood: string | null;
  soundCodes: string[] | null;
  targetTurnoverHours: number | null;
  enabled: boolean | null;
}

export interface EngineCategory {
  id: string;
  name: string;
  kind: string; // 'music' | 'imaging' | 'voicetrack'
  parentId: string | null;
  defaultTargetTurnoverHours: number | null;
}

export interface PositionConstraints {
  moodTarget?: string;
  soundCodesInclude?: string[];
  soundCodesExclude?: string[];
  fallbackCategoryId?: string;
  fixedDurationSeconds?: number;
}

export type PositionType = "category" | "fixed_event" | "sweeper" | "voicetrack";

export interface EnginePosition {
  id: string;
  sortOrder: number;
  positionType: PositionType;
  categoryId: string | null;
  targetOffsetSeconds: number | null;
  constraints: PositionConstraints | null;
  fixedRef: string | null;
}

export interface EngineClock {
  id: string;
  name: string;
  positions: EnginePosition[];
}

export interface GridSlot {
  dayOfWeek: number; // 0 = Sunday, station-local
  hour: number; // 0-23, station-local
  clockId: string;
}

export type RuleScope = "global" | "category" | "position";
export type RuleHardness = "hard" | "soft";

export interface EngineRule {
  id: string;
  scope: RuleScope;
  scopeRef: string | null;
  ruleType: string;
  params: Record<string, unknown> | null;
  hardness: RuleHardness;
  weight: number | null;
}

export interface HistoryEntry {
  rdjSongId: number | null;
  artist: string | null;
  /** Joined from the mirror by the loader (play_history doesn't store title); null rows participate in artist separation only. */
  title: string | null;
  airedAt: Date;
}

export interface EngineWeights {
  rest: number;
  flow: number;
  era: number;
  mood: number;
  sound: number;
  nearSeparationPenalty: number;
}

export interface EngineConfig {
  /** Top-K pick pool size. */
  searchDepth: number;
  jitterMagnitude: number;
  weights: EngineWeights;
  /** Window-shrink factors for the relaxation ladder, applied in order. */
  relaxationSteps: number[];
  defaultDurationMs: number;
  defaultTurnoverHours: number;
  /** positionType -> allowed RadioDJ song_type values. */
  songTypeMap: Record<string, number[]>;
}

// Weight calibration: the positive weights sum to 0.95 — incidental, not a
// constraint; only ratios matter since a uniform scale shifts every score equally.
// The anchors are calibrated against the REST RANGE (0..rest = the entire
// discriminating spread on an untagged library, where all other soft components
// are a constant 0.5×weight): jitterMagnitude ±0.05 spans 12.5% of it, so jitter
// shuffles near-ties but can't flip a well-rested pick; max near-separation bite
// is nearSeparationPenalty × 0.5 = 0.125 ≈ 31% of it. Tune new values against
// the rest range, not against a weight sum of 1.0.
export const DEFAULT_CONFIG: EngineConfig = {
  searchDepth: 5,
  jitterMagnitude: 0.05,
  weights: { rest: 0.4, flow: 0.2, era: 0.15, mood: 0.1, sound: 0.1, nearSeparationPenalty: 0.25 },
  relaxationSteps: [0.75, 0.5, 0.25],
  defaultDurationMs: 210_000,
  defaultTurnoverHours: 24,
  songTypeMap: { category: [0], sweeper: [1, 2], voicetrack: [3] },
};

export interface Violation {
  step:
    | "drop_secondary_hard"
    | "shrink_artist"
    | "shrink_title"
    | "fallback_category"
    | "last_resort"
    | "unfillable";
  detail: Record<string, unknown>;
}

export type ElementType = "music" | "sweeper" | "voicetrack" | "fixed_event";

export interface GeneratedItem {
  sortOrder: number;
  projectedAirAt: Date;
  elementType: ElementType;
  songId: string | null;
  rdjSongId: number | null;
  clockPositionId: string | null;
  violations: Violation[];
}

export interface GenerateLogInput {
  timezone: string;
  horizonStart: Date;
  horizonEnd: Date;
  seed: string;
  clocks: EngineClock[];
  grid: GridSlot[];
  categories: EngineCategory[];
  songs: EngineSong[];
  rules: EngineRule[];
  history: HistoryEntry[];
  config?: Partial<EngineConfig>;
}

export interface GenerateLogResult {
  items: GeneratedItem[];
  warnings: string[];
  stats: {
    totalItems: number;
    violationCounts: Record<string, number>;
    unfillable: number;
  };
}
