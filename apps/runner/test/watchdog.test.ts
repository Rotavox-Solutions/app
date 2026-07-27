import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkHeartbeat,
  createWatchdogState,
  STALE_THRESHOLD_MS,
  type WatchdogDeps,
  type WatchdogState,
} from "../src/watchdog.js";

/**
 * The watchdog is the last line of defence against dead air: AutoDJ-off is only valid
 * while a healthy pacer drives the queue, and this is what notices when that stops
 * being true. Its whole job is a failure path, so the failure path is what's tested —
 * with the heartbeat reader and the REST call injected, no live pacer or rig needed.
 */

const FRESH = 1_000;
const STALE = STALE_THRESHOLD_MS + 1;

function harness(ages: Array<number | null>) {
  const forceAutoDj = vi.fn(async () => {});
  let i = 0;
  const deps: WatchdogDeps = {
    heartbeatAgeMs: async () => ages[Math.min(i++, ages.length - 1)] ?? null,
    forceAutoDj,
  };
  const state = createWatchdogState();
  const poll = async () => checkHeartbeat(deps, state);
  return { deps, state, poll, forceAutoDj };
}

async function pollTimes(poll: () => Promise<void>, n: number): Promise<void> {
  for (let k = 0; k < n; k++) await poll();
}

describe("watchdog fail-safe", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("leaves AutoDJ alone while the heartbeat is fresh", async () => {
    const { poll, forceAutoDj, state } = harness([FRESH]);

    await pollTimes(poll, 3);

    expect(forceAutoDj).not.toHaveBeenCalled();
    expect(state.forced).toBe(false);
  });

  it("forces AutoDJ back on once the heartbeat goes stale", async () => {
    const { poll, forceAutoDj, state } = harness([STALE]);

    await poll();

    expect(forceAutoDj).toHaveBeenCalledTimes(1);
    expect(state.forced).toBe(true);
  });

  it("treats an unreadable heartbeat as unknown, not stale (rename race)", async () => {
    // heartbeat.ts writes via write-then-rename; a reader can catch the gap. Forcing
    // AutoDJ here would yank playout away from a perfectly healthy pacer.
    const { poll, forceAutoDj } = harness([null]);

    await pollTimes(poll, 5);

    expect(forceAutoDj).not.toHaveBeenCalled();
  });

  it("does not clear the latch on an unreadable read (unknown is not recovery)", async () => {
    // Stale -> force -> unreadable. If `null` cleared the latch, the next stale poll
    // would re-fire EnableAutoDJ, which is exactly the hammering the latch prevents.
    const { poll, forceAutoDj, state } = harness([STALE, null, STALE]);

    await pollTimes(poll, 3);

    expect(forceAutoDj).toHaveBeenCalledTimes(1);
    expect(state.forced).toBe(true);
  });

  it("latches: a sustained stale episode forces exactly once", async () => {
    const { poll, forceAutoDj } = harness([STALE]);

    await pollTimes(poll, 10);

    expect(forceAutoDj).toHaveBeenCalledTimes(1);
  });

  it("unlatches when the pacer recovers, and re-arms for the next episode", async () => {
    const { poll, forceAutoDj, state } = harness([STALE, STALE, FRESH, STALE]);

    await poll(); // stale -> force
    await poll(); // still stale -> suppressed
    expect(forceAutoDj).toHaveBeenCalledTimes(1);

    await poll(); // fresh -> pacer recovered, latch clears
    expect(state.forced).toBe(false);

    await poll(); // stale again -> must fire a second time
    expect(forceAutoDj).toHaveBeenCalledTimes(2);
  });

  it("retries on the next poll when the REST call fails", async () => {
    // A failed force means RadioDJ may still have AutoDJ off — latching here would
    // leave the station silent with the watchdog believing it had handled things.
    const forceAutoDj = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("REST plugin unreachable"))
      .mockResolvedValueOnce(undefined);
    const deps: WatchdogDeps = { heartbeatAgeMs: async () => STALE, forceAutoDj };
    const state: WatchdogState = createWatchdogState();

    await checkHeartbeat(deps, state);
    expect(state.forced).toBe(false); // not latched — the force didn't land

    await checkHeartbeat(deps, state);
    expect(forceAutoDj).toHaveBeenCalledTimes(2);
    expect(state.forced).toBe(true);
  });

  it("treats exactly-at-threshold as fresh, one ms past as stale", async () => {
    const atThreshold = harness([STALE_THRESHOLD_MS]);
    await atThreshold.poll();
    expect(atThreshold.forceAutoDj).not.toHaveBeenCalled();

    const pastThreshold = harness([STALE_THRESHOLD_MS + 1]);
    await pastThreshold.poll();
    expect(pastThreshold.forceAutoDj).toHaveBeenCalledTimes(1);
  });
});
