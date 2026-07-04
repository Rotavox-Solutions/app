// Buffer against the pace loop's queue-depth-driven (not time-locked) push timing
// for non-TOH items (apps/runner/src/cursor.ts) — pushed_at alone would be racy,
// since an item can be pushed well before its projected_air_at if the queue
// happens to drain. Starting point, not a measured value — confirm against the
// real rig's queue-drain rate once live and adjust (M4a plan, Decision 2).
export const SAFETY_HORIZON_MINUTES = 15;

export const HOUR_MS = 3_600_000;
