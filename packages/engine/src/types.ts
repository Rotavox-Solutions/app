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
  /**
   * Marks this position as a CONDITIONAL filler candidate rather than programmed
   * content. Lower number = activated sooner.
   *
   * Clocks are authored to a position count, but songs vary in length, so an hour's
   * real duration is only known at generation. Candidates are pre-placed at spread
   * positions and ranked; the generator activates as many as the hour's deficit
   * requires and drops the rest.
   *
   * They must be resolved at GENERATION, not at playout. The log is the artifact the
   * PD approves — a filler chosen by the pacer at airtime is intent being decided at
   * execution time, by the component with the least context and no review. Pre-placed
   * filler stays swappable, overridable and removable before air.
   */
  fillerPriority?: number;
  /**
   * Order in which this position is SACRIFICED when the hour cannot fit its budget.
   * Lower number = given up first. Absent = never chosen deliberately (it can still
   * fall off the tail as a last resort).
   *
   * The additive counterpart of fillerPriority. An hour can be short (activate filler)
   * or long (give something up), and both decisions belong at generation where the PD
   * can see them -- a shear that happens at playout takes whatever is at the tail,
   * which is arbitrary with respect to programming value.
   */
  trimPriority?: number;
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
  /** Clock length in minutes. Positions whose projected start reaches this bound are
   * trimmed from the tail. Defaults to 60 when omitted. */
  lengthMinutes?: number;
  positions: EnginePosition[];
}

export interface GridSlot {
  dayOfWeek: number; // 0 = Sunday, station-local
  hour: number; // 0-23, station-local
  /** Rotation week this cell applies to (0-based). Omit/0 for a static weekly grid. */
  weekInCycle?: number;
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
  /** Rewards landing far from this song's recent hours-of-day. */
  hourSpread: number;
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
  weights: { rest: 0.4, flow: 0.2, era: 0.15, mood: 0.1, sound: 0.1, nearSeparationPenalty: 0.25, hourSpread: 0.2 },
  relaxationSteps: [0.75, 0.5, 0.25],
  defaultDurationMs: 210_000,
  defaultTurnoverHours: 24,
  // sweeper covers all imaging picked by a category-scoped sweeper position: RadioDJ
  // song_type 1 (jingles/IDs), 2 (sweepers/liners), and 4 (station promos). Because
  // these positions are always category-scoped, widening the type set can't cross
  // content between imaging categories — it only lets a promo position (category
  // "Station Promos", type 4) resolve at all.
  songTypeMap: { category: [0], sweeper: [1, 2, 4], voicetrack: [3] },
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
  /** Rotation cycle length in weeks; 1 (or omitted) = a static weekly grid. */
  cycleWeeks?: number;
  /** Instant whose station-local calendar date anchors week 0 of the rotation cycle.
   * Null/omitted (or cycleWeeks≤1) disables rotation — the engine reads only week 0. */
  cycleEpoch?: Date | null;
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
    /** Clock positions dropped from the tail because the hour was full. */
    trimmed: number;
    /** Conditional filler positions activated because hours came up short. */
    fillerActivated: number;
    /** Positions deliberately given up because an hour could not fit its budget. */
    sacrificed: number;
  };
}
