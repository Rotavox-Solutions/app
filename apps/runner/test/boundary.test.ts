import { describe, expect, it } from "vitest";
import {
  decideBoundaryAction,
  drainInstant,
  EARLY_AIR_MS,
  EARLY_AIR_HARD_CAP_MS,
} from "../src/boundary.js";

/**
 * The top-of-hour boundary, tested against the defect it was reported for: the station
 * ID sits in clock slot #1 yet aired consistently at :10 to :13.
 *
 * Forensics on two days of aired log settled the cause. The gate was exact — the ID was
 * queued 6-10s before it was due, every hour. What was wrong was the underrun guard: it
 * fired on queue DEPTH while the hole it guards against is measured in TIME, so at
 * `depth <= 1` (one remaining item, routinely a three-minute song) it injected a whole
 * record to bridge a hole that did not exist. Every drift step equalled the injected
 * audio exactly, and across 48 consecutive hours the residual was 48 over / 0 short.
 *
 * These cover the arithmetic and the decision, with no DB and no rig.
 */

const MIN = 60_000;
const at = (iso: string) => new Date(iso);

describe("drainInstant — when the next pushed item would begin", () => {
  const now = at("2026-08-20T14:55:00.000Z");

  it("is now when nothing is playing and nothing is queued", () => {
    expect(drainInstant(now, null, 0).toISOString()).toBe(now.toISOString());
  });

  it("stacks queued audio behind the in-progress track", () => {
    const playingEnds = at("2026-08-20T14:57:00.000Z").getTime();
    expect(drainInstant(now, playingEnds, 6 * MIN).toISOString()).toBe("2026-08-20T15:03:00.000Z");
  });

  it("never reports a drain in the past when the playing track has overrun its duration", () => {
    // aired_at + duration can land behind `now` after a skip or a segue. The queue
    // still cannot drain earlier than the present.
    const playingEnds = at("2026-08-20T14:50:00.000Z").getTime();
    expect(drainInstant(now, playingEnds, 0).toISOString()).toBe(now.toISOString());
  });

  it("counts bridged audio the query cannot see", () => {
    // A bridge re-pushes an already-aired item, so it keeps its original aired_at and
    // looks like history. Unaccounted, the next tick measures the same hole again.
    const withoutBridge = drainInstant(now, null, 0);
    const withBridge = drainInstant(now, null, 194_000);
    expect(withBridge.getTime() - withoutBridge.getTime()).toBe(194_000);
  });
});

describe("decideBoundaryAction — time, not depth", () => {
  it("waits when committed audio already carries past the boundary", () => {
    // The normal case for a properly scheduled hour: 48 of 48 measured hours were
    // overscheduled, so the queue reaches :00 with audio to spare.
    expect(decideBoundaryAction(-117_000)).toEqual({ action: "wait" });
    expect(decideBoundaryAction(0)).toEqual({ action: "wait" });
  });

  it("waits rather than guessing when no due time is known", () => {
    expect(decideBoundaryAction(null)).toEqual({ action: "wait" });
  });

  it("airs the ID early for a hole inside the nominal tolerance", () => {
    expect(decideBoundaryAction(12_000)).toEqual({
      action: "air-early",
      earlyByMs: 12_000,
      atCap: false,
    });
  });

  it("treats the nominal tolerance as inclusive", () => {
    expect(decideBoundaryAction(EARLY_AIR_MS)).toMatchObject({ action: "air-early", atCap: false });
  });

  it("still airs early past the nominal bound, but flags it", () => {
    // Between 30s and 45s the hour has visibly run short: worth airing early rather
    // than injecting 169s+ of music, but worth saying out loud.
    expect(decideBoundaryAction(38_000)).toEqual({
      action: "air-early",
      earlyByMs: 38_000,
      atCap: true,
    });
    expect(decideBoundaryAction(EARLY_AIR_HARD_CAP_MS)).toMatchObject({ atCap: true });
  });

  it("bridges only beyond the hard backward limit", () => {
    // Past 45s a listener places the ID in the wrong hour, so audio has to fill it —
    // dead air is never the answer.
    expect(decideBoundaryAction(EARLY_AIR_HARD_CAP_MS + 1)).toEqual({
      action: "bridge",
      gapMs: EARLY_AIR_HARD_CAP_MS + 1,
    });
    expect(decideBoundaryAction(3 * MIN)).toMatchObject({ action: "bridge" });
  });

  it("would not have fired on the conditions that caused the incident", () => {
    // The old rule fired at depth<=1 with a full song still to play. Measured as time,
    // that is a NEGATIVE gap — audio in hand, nothing to bridge.
    const now = at("2026-08-20T14:58:00.000Z");
    const oneSongLeft = drainInstant(now, at("2026-08-20T15:01:10.000Z").getTime(), 0);
    const dueAt = at("2026-08-20T15:00:00.000Z");
    expect(decideBoundaryAction(dueAt.getTime() - oneSongLeft.getTime())).toEqual({ action: "wait" });
  });

  it("never injects a record to close a gap no record could fit", () => {
    // The library is bimodal: imaging <= 15s, music >= 169s, nothing between. Any hole
    // the early-air window covers must therefore be closed by airing early, because
    // bridging it would overrun by more than the hole itself.
    for (const gap of [1_000, 15_000, 30_000, 45_000]) {
      expect(decideBoundaryAction(gap).action).toBe("air-early");
    }
  });
});
