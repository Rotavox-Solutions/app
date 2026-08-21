/**
 * What to do as the top of the hour approaches.
 *
 * I/O-free so the boundary can be tested without a rig — same reason the scheduling
 * engine is a pure package. cursor.ts supplies the measurements; this decides.
 *
 * THE DEFECT THIS REPLACES
 * ------------------------
 * The underrun guard fired on queue DEPTH (`depth <= 1`, items) while the thing it
 * guards against is a TIME gap. When the pacer reaches the gated ID it stops pushing
 * and the queue drains 3 → 2 → 1; at depth 1 the guard fired even though that single
 * remaining item is routinely a three-minute song. It bridged a hole that did not
 * exist, using a whole record, and the ID then aired behind it.
 *
 * Measured 2026-08-18/19: every drift step equalled the injected audio exactly
 * (+598s vs 596s, +429s vs 429s, +272s vs 273s), and across 48 consecutive scheduled
 * hours the residual was 48 over / 0 short — so there was never an underrun to bridge
 * in the first place. Every fire was a false positive.
 *
 * THE RULE
 * --------
 * Measure the hole in seconds, not in items, and prefer airing the ID early over
 * injecting audio. The ID is a 2-5s element; airing it half a minute early is inside
 * the station's tolerance, where injecting a 194s record is not — and there is no
 * inventory between ~15s and ~169s to inject instead.
 */

/** Nominal backward tolerance (PERFECT-HOUR.md §5b). Air the ID early rather than bridge. */
export const EARLY_AIR_MS = 30_000;

/**
 * Absolute backward limit. Past this a listener glancing at a clock places the ID in
 * the wrong hour, so a hole this wide has to be filled with audio however unwelcome
 * that is — dead air is never the answer.
 */
export const EARLY_AIR_HARD_CAP_MS = 45_000;

export type BoundaryAction =
  /** Committed audio covers the boundary. Leave the gate to open on its own. */
  | { action: "wait" }
  /** Push the ID ahead of its gate; it airs when the committed audio runs out. */
  | { action: "air-early"; earlyByMs: number; atCap: boolean }
  /** The hole is too wide to absorb by airing early. Bridge it, and say so loudly. */
  | { action: "bridge"; gapMs: number };

/**
 * When the content RadioDJ already holds will run out — the instant the next thing we
 * push would actually begin.
 *
 * `playingEndsAt` is the in-progress track's finish (aired_at + its segue-aware
 * duration); `pendingMs` is everything pushed behind it and not yet started. Clamped
 * at `now` because aired_at + duration can land in the past after a skip or a segue,
 * and the queue still cannot drain earlier than the present.
 */
export function drainInstant(now: Date, playingEndsAt: number | null, pendingMs: number): Date {
  return new Date(Math.max(now.getTime(), playingEndsAt ?? now.getTime()) + pendingMs);
}

/**
 * `gapMs` is how long the queue would sit empty before the ID is due: the ID's due
 * instant minus the drain instant. Negative or zero means committed audio already
 * carries us to the boundary, which is the normal case for a properly scheduled hour.
 *
 * null means no due time is known — fall back to the gate rather than guess.
 */
export function decideBoundaryAction(gapMs: number | null): BoundaryAction {
  if (gapMs === null || gapMs <= 0) return { action: "wait" };
  if (gapMs <= EARLY_AIR_MS) return { action: "air-early", earlyByMs: gapMs, atCap: false };
  if (gapMs <= EARLY_AIR_HARD_CAP_MS) return { action: "air-early", earlyByMs: gapMs, atCap: true };
  return { action: "bridge", gapMs };
}
