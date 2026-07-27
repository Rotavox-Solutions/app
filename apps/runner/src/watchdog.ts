import "dotenv/config";
import { restCall } from "./rest.js";
import { heartbeatAgeMs } from "./heartbeat.js";

// Deliberately independent of pace.ts: no Postgres, no MariaDB — only the RadioDJ
// REST plugin (RADIODJ_REST_*) and a local heartbeat file. The failure modes this
// exists to catch (a hung or killed Runner process) must not be able to take the
// watchdog down with them. Runs as its own systemd service (see deploy/systemd/).
const POLL_INTERVAL_MS = 5_000;
// ~4 missed ticks (paceLoop writes a heartbeat every 5s) — conservative relative to
// MIN_DEPTH=3's real ~10-15 min of already-queued audio, tight enough to bound the
// actual dead-air exposure once that buffer does run out.
export const STALE_THRESHOLD_MS = 20_000;

/**
 * The two effects the fail-safe needs, injected rather than imported directly so the
 * decision logic is testable without a live pacer or REST plugin. This is the one
 * component whose entire job is a failure path, so it gets exercised in tests instead
 * of only in production (see test/watchdog.test.ts).
 */
export interface WatchdogDeps {
  /** Age of the pacer's heartbeat in ms, or `null` if unreadable this poll. */
  heartbeatAgeMs: () => Promise<number | null>;
  /** Hand playout back to RadioDJ's own rotation. */
  forceAutoDj: () => Promise<void>;
}

/**
 * Latch, threaded explicitly instead of held in a module-level `let`, so each test
 * starts from a known state. `forced` means "a stale episode is currently being
 * handled" — it suppresses re-forcing EnableAutoDJ on every subsequent poll and
 * clears only when the heartbeat is observed fresh again.
 */
export interface WatchdogState {
  forced: boolean;
}

export function createWatchdogState(): WatchdogState {
  return { forced: false };
}

export async function checkHeartbeat(deps: WatchdogDeps, state: WatchdogState): Promise<void> {
  const age = await deps.heartbeatAgeMs();

  // Unknown, NOT stale — a read can transiently race the writer's rename (see
  // heartbeat.ts). Deliberately returns before touching the latch: an unreadable
  // heartbeat is not evidence the pacer recovered, so a stale episode already being
  // handled must stay latched rather than re-firing on the next poll.
  if (age === null) {
    console.warn("[watchdog] heartbeat unreadable this poll (transient?) — skipping.");
    return;
  }

  if (age <= STALE_THRESHOLD_MS) {
    if (state.forced) {
      console.log("[watchdog] heartbeat fresh again — pacer has recovered.");
    }
    state.forced = false;
    return;
  }

  if (state.forced) return;

  console.warn(`[watchdog] heartbeat stale (${Math.round(age / 1000)}s) — forcing EnableAutoDJ=1.`);
  try {
    await deps.forceAutoDj();
    // Latched only on success: if the REST call failed, RadioDJ may still be sitting
    // with AutoDJ off, so the next poll must try again rather than assume it's handled.
    state.forced = true;
  } catch (err) {
    console.error("[watchdog] failed to force EnableAutoDJ (will retry next poll):", err);
  }
}

async function main(): Promise<void> {
  console.log(`[watchdog] watching heartbeat, stale threshold ${STALE_THRESHOLD_MS}ms, poll every ${POLL_INTERVAL_MS}ms.`);
  const deps: WatchdogDeps = {
    heartbeatAgeMs,
    forceAutoDj: async () => {
      await restCall("EnableAutoDJ", 1);
    },
  };
  const state = createWatchdogState();
  while (true) {
    await checkHeartbeat(deps, state);
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}

if (process.argv[1]?.endsWith("watchdog.ts")) {
  process.on("SIGINT", () => process.exit(0));
  process.on("SIGTERM", () => process.exit(0));

  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
