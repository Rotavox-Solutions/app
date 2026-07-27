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
const STALE_THRESHOLD_MS = 20_000;

// Avoid hammering EnableAutoDJ every poll once a stale episode has already been
// handled; reset once the heartbeat freshens (pacer recovered).
let alreadyForced = false;

async function checkHeartbeat(): Promise<void> {
  const age = await heartbeatAgeMs();

  if (age === null) {
    console.warn("[watchdog] heartbeat unreadable this poll (transient?) — skipping.");
    return;
  }

  if (age <= STALE_THRESHOLD_MS) {
    if (alreadyForced) {
      console.log("[watchdog] heartbeat fresh again — pacer has recovered.");
    }
    alreadyForced = false;
    return;
  }

  if (alreadyForced) return;

  console.warn(`[watchdog] heartbeat stale (${Math.round(age / 1000)}s) — forcing EnableAutoDJ=1.`);
  try {
    await restCall("EnableAutoDJ", 1);
    alreadyForced = true;
  } catch (err) {
    console.error("[watchdog] failed to force EnableAutoDJ (will retry next poll):", err);
  }
}

async function main(): Promise<void> {
  console.log(`[watchdog] watching heartbeat, stale threshold ${STALE_THRESHOLD_MS}ms, poll every ${POLL_INTERVAL_MS}ms.`);
  while (true) {
    await checkHeartbeat();
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}

process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
