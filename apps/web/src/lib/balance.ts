// Category balance — supply (pool depth) against demand (clock slots), stated as the
// turnover a PD reasons in. Pure: the DB load lives in queries.ts.
//
// This is the FORMAT-WORKFLOW §1c convergence loop made visible. Depth sets supply,
// clocks set demand, turnover is the ratio — the arithmetic behind the A1-at-7-songs
// repetition complaint, and the same arithmetic as tools/depth-solver.mjs:
//
//   turnover_hours = 168 * depth / slots_per_week

export const HOURS_PER_WEEK = 168;

/** Projected turnover within this band of target counts as on target. */
export const BALANCE_TOLERANCE = { hot: 0.8, cold: 1.25 };

export type BalanceStatus =
  | "empty" // called by a clock, but nothing schedulable in the pool
  | "covered" // empty, but every position calling it falls back to another category
  | "hot" // repeats faster than its target
  | "on_target"
  | "cold" // rests longer than its target — songs underexposed
  | "no_target" // called, but no turnover target set
  | "filler" // only conditional filler positions call it — no designed demand to measure
  | "fallback" // no position calls it directly, but it backs up positions that do
  | "uncalled"; // no clock calls it (rest, bench, or orphaned)

export interface BalanceCategoryInput {
  id: string;
  name: string;
  kind: string;
  parentId: string | null;
  defaultTargetTurnoverHours: number | null;
  /** Standard rest for songs resting from this pool (ADR-0002 §6.2). */
  restReviewDays?: number | null;
}

export interface BalanceInput {
  categories: BalanceCategoryInput[];
  /** One row per (song, category) membership. */
  memberships: {
    songId: string;
    categoryId: string;
    enabled: boolean | null;
    /** 'primary' | 'also' — omitted counts as primary. */
    role?: string;
    /** Omitted counts as active. */
    lifecycleState?: string;
    lifecycleSince?: Date | null;
  }[];
  /** Positions that call a category, with the clock they belong to. */
  positions: {
    clockId: string;
    categoryId: string | null;
    fallbackCategoryId?: string | null;
    /** Set on conditional filler positions, which air only when an hour runs short. */
    fillerPriority?: number | null;
  }[];
  /** Every grid cell across every week of the rotation cycle. */
  grid: { clockId: string }[];
  cycleWeeks: number;
  /** Spins per song over the recent window, from play_history. */
  recentSpinsBySong: Map<string, number>;
  /** "Now", for rest-review arithmetic. Defaults to the current time. */
  now?: Date;
}

export interface CategoryBalance {
  id: string;
  name: string;
  kind: string;
  parentId: string | null;
  /** A grouping node (Currents, Gold …) — its depth is the sum of its sub-pools. */
  hasChildren: boolean;
  /** Songs whose primary pool is this one or a sub-pool, in any lifecycle state. */
  depth: number;
  /**
   * Of those, enabled and active — what the engine can actually schedule, and so the
   * real depth. Resting songs keep their pool but are excluded (ADR-0002 §3).
   */
  enabledDepth: number;
  /** Songs resting from this pool. */
  restingDepth: number;
  /**
   * Resting songs that have passed the pool's standard rest and are waiting on a
   * decision. A prompt, never a move: rest exit is decided case by case (ADR-0002 §6.1).
   */
  restDue: number;
  /**
   * Schedulable songs eligible here as an 'also' (their primary pool is elsewhere). Kept
   * out of depth and turnover: their plays are shared with another pool, and counting them
   * twice is how one song quietly props up two pools (ADR-0002 §6.4).
   */
  alsoDepth: number;
  /** Positions calling this category per week, averaged over the rotation cycle. */
  weeklySlots: number;
  /**
   * Conditional filler positions per week. Kept out of `weeklySlots`: they air only when
   * an hour comes up short, so counting them as demand would overstate it many times over.
   */
  weeklyFillerSlots: number;
  /** Positions per week that fall back to this category when their own pool can't fill. */
  weeklyFallbackSlots: number;
  /** Hours for the pool to cycle once, at designed demand. Null when uncalled or empty. */
  projectedTurnoverHours: number | null;
  targetTurnoverHours: number | null;
  restReviewDays: number | null;
  status: BalanceStatus;
  /** Actual spins of this pool's songs over the recent window. Fallback lands here. */
  recentSpins: number;
}

function descendantsOf(rootId: string, childrenOf: Map<string, string[]>): Set<string> {
  const out = new Set<string>([rootId]);
  const stack = [rootId];
  while (stack.length) {
    for (const child of childrenOf.get(stack.pop()!) ?? []) {
      if (!out.has(child)) {
        out.add(child);
        stack.push(child);
      }
    }
  }
  return out;
}

export function classifyBalance(
  weeklySlots: number,
  enabledDepth: number,
  projected: number | null,
  target: number | null,
  fullyCoveredByFallback = false,
  weeklyFillerSlots = 0,
  weeklyFallbackSlots = 0
): BalanceStatus {
  if (weeklySlots === 0 && weeklyFillerSlots === 0 && weeklyFallbackSlots > 0) return "fallback";
  if (weeklySlots === 0 && weeklyFillerSlots > 0) return enabledDepth === 0 ? "empty" : "filler";
  if (weeklySlots === 0) return "uncalled";
  if (enabledDepth === 0) return fullyCoveredByFallback ? "covered" : "empty";
  if (target == null || projected == null) return "no_target";
  const ratio = projected / target;
  if (ratio < BALANCE_TOLERANCE.hot) return "hot";
  if (ratio > BALANCE_TOLERANCE.cold) return "cold";
  return "on_target";
}

export function computeBalance(input: BalanceInput): CategoryBalance[] {
  const now = input.now ?? new Date();
  const childrenOf = new Map<string, string[]>();
  for (const c of input.categories) {
    if (!c.parentId) continue;
    childrenOf.set(c.parentId, [...(childrenOf.get(c.parentId) ?? []), c.id]);
  }

  // How many times each clock airs per cycle, then per week.
  const airingsPerWeek = new Map<string, number>();
  const cycleWeeks = Math.max(1, input.cycleWeeks);
  for (const cell of input.grid) {
    airingsPerWeek.set(cell.clockId, (airingsPerWeek.get(cell.clockId) ?? 0) + 1 / cycleWeeks);
  }
  const slotsByCategory = new Map<string, number>();
  const fillerSlotsByCategory = new Map<string, number>();
  const fallbackSlotsByCategory = new Map<string, number>();
  const uncoveredPosition = new Set<string>(); // categories with a position that has no fallback
  for (const p of input.positions) {
    if (!p.categoryId) continue;
    const target = p.fillerPriority != null ? fillerSlotsByCategory : slotsByCategory;
    target.set(p.categoryId, (target.get(p.categoryId) ?? 0) + (airingsPerWeek.get(p.clockId) ?? 0));
    if (!p.fallbackCategoryId) uncoveredPosition.add(p.categoryId);
    else
      fallbackSlotsByCategory.set(
        p.fallbackCategoryId,
        (fallbackSlotsByCategory.get(p.fallbackCategoryId) ?? 0) + (airingsPerWeek.get(p.clockId) ?? 0)
      );
  }

  const membersByCategory = new Map<string, BalanceInput["memberships"]>();
  for (const m of input.memberships) {
    membersByCategory.set(m.categoryId, [...(membersByCategory.get(m.categoryId) ?? []), m]);
  }
  const schedulable = (m: BalanceInput["memberships"][number]) =>
    m.enabled === true && (m.lifecycleState ?? "active") === "active";

  return input.categories.map((c) => {
    const pool = descendantsOf(c.id, childrenOf);
    const songs = new Map<string, BalanceInput["memberships"][number]>();
    const also = new Set<string>();
    for (const catId of pool) {
      for (const m of membersByCategory.get(catId) ?? []) {
        if ((m.role ?? "primary") === "primary") songs.set(m.songId, m);
        else if (schedulable(m)) also.add(m.songId);
      }
    }
    for (const songId of songs.keys()) also.delete(songId);
    const depth = songs.size;
    const enabledDepth = [...songs.values()].filter(schedulable).length;
    const resting = [...songs.values()].filter((m) => m.lifecycleState === "resting");
    const restingDepth = resting.length;
    const restCutoff = c.restReviewDays != null ? now.getTime() - c.restReviewDays * 86_400_000 : null;
    // Only this pool's own songs: a parent's rest standard does not reach into sub-pools
    // that set their own, so count against direct membership.
    const restDue =
      restCutoff == null
        ? 0
        : (membersByCategory.get(c.id) ?? []).filter(
            (m) =>
              (m.role ?? "primary") === "primary" &&
              m.lifecycleState === "resting" &&
              m.lifecycleSince != null &&
              m.lifecycleSince.getTime() <= restCutoff
          ).length;
    const weeklySlots = slotsByCategory.get(c.id) ?? 0;
    const weeklyFillerSlots = fillerSlotsByCategory.get(c.id) ?? 0;
    const weeklyFallbackSlots = fallbackSlotsByCategory.get(c.id) ?? 0;
    const projectedTurnoverHours =
      weeklySlots > 0 && enabledDepth > 0 ? (HOURS_PER_WEEK * enabledDepth) / weeklySlots : null;
    let recentSpins = 0;
    for (const songId of songs.keys()) recentSpins += input.recentSpinsBySong.get(songId) ?? 0;

    return {
      id: c.id,
      name: c.name,
      kind: c.kind,
      parentId: c.parentId,
      hasChildren: childrenOf.has(c.id),
      depth,
      enabledDepth,
      restingDepth,
      restDue,
      alsoDepth: also.size,
      weeklySlots,
      weeklyFillerSlots,
      weeklyFallbackSlots,
      projectedTurnoverHours,
      targetTurnoverHours: c.defaultTargetTurnoverHours,
      restReviewDays: c.restReviewDays ?? null,
      status: classifyBalance(
        weeklySlots,
        enabledDepth,
        projectedTurnoverHours,
        c.defaultTargetTurnoverHours,
        !uncoveredPosition.has(c.id),
        weeklyFillerSlots,
        weeklyFallbackSlots
      ),
      recentSpins,
    };
  });
}

/**
 * Statuses a PD should act on. `cold` and `no_target` are worth a look, not an alarm;
 * `covered` is a known gap (unproduced imaging, say) that already airs something else.
 */
export function needsAttention(b: CategoryBalance): boolean {
  return b.status === "empty" || b.status === "hot";
}

/** Songs the pool needs to land its target at current demand. Null when uncalled or untargeted. */
export function requiredDepth(b: CategoryBalance): number | null {
  if (b.weeklySlots === 0 || b.targetTurnoverHours == null) return null;
  return Math.ceil((b.targetTurnoverHours * b.weeklySlots) / HOURS_PER_WEEK);
}
