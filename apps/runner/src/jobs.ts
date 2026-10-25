// The Runner's job loop: does what the UI asks for on the broadcast box (ADR-0001
// invariant #4 — the web app queues work in Postgres, the Runner does it). Also keeps
// the routine work going without anyone asking: a periodic library sync, and writing
// applied changes to RadioDJ.
//
// Runs inside the pacer process, beside the pace loop. It must never take the pacer down,
// so every failure stays inside a job and is recorded on it.
import {
  claimNextJob,
  enqueueJob,
  failInterruptedJobs,
  finishJob,
  lastRequested,
  nextProjectionStatus,
  pruneJobs,
  type RunnerJob,
} from "@rotavox/schema";
import { schedulerDb, stationId } from "./scheduler-db.js";
import { syncLibrary } from "./sync-library.js";
import { projectChangesets } from "./project-changesets.js";
import type { ApplyLog } from "./apply-changeset.js";

const POLL_MS = 5_000;
/** How often the library is synced unprompted, so songs added in RadioDJ reach the Inbox. */
export const SCHEDULED_SYNC_MINUTES = 15;
const KEEP_SCHEDULED_DAYS = 7;
/** Output kept per job. Enough for a sync's drift report; a runaway log stops here. */
const OUTPUT_LIMIT = 200_000;

type Say = (...args: unknown[]) => void;

function capture(): { log: ApplyLog; text: () => string } {
  const lines: string[] = [];
  const push = (prefix: string) => (line: string) => {
    if (lines.join("\n").length < OUTPUT_LIMIT) lines.push(prefix + line);
  };
  return { log: { info: push(""), warn: push("warning: "), error: push("error: ") }, text: () => lines.join("\n") };
}

async function runJob(job: RunnerJob): Promise<{ ok: boolean; summary: string; output: string }> {
  const out = capture();
  try {
    if (job.kind === "sync_library") {
      const r = await syncLibrary(out.log.info);
      const parts = [
        r.fetched ? `${r.fetched} changed in RadioDJ` : null,
        r.repaired ? `${r.repaired} repaired` : null,
      ].filter(Boolean);
      return { ok: true, summary: parts.length ? parts.join(", ") : "Already up to date", output: out.text() };
    }
    if (job.kind === "project_changesets") {
      const r = await projectChangesets({ apply: true, log: out.log });
      if (r.stopped) return { ok: false, summary: r.stopped, output: out.text() };
      return {
        ok: true,
        summary: r.projected ? `${r.projected} change(s) written to RadioDJ` : "Nothing to write",
        output: out.text(),
      };
    }
    return { ok: false, summary: `Unknown job kind "${job.kind}"`, output: "" };
  } catch (err) {
    out.log.error(String((err as Error).stack ?? err));
    return { ok: false, summary: (err as Error).message ?? String(err), output: out.text() };
  }
}

/** Queues the work nobody has to ask for. */
async function scheduleRoutine(now: Date): Promise<void> {
  const lastSync = await lastRequested(schedulerDb, stationId, "sync_library");
  if (!lastSync || now.getTime() - lastSync.getTime() > SCHEDULED_SYNC_MINUTES * 60_000) {
    await enqueueJob(schedulerDb, stationId, "sync_library", "schedule");
  }
  // A failure at the head of the line waits for a person to retry it from the UI.
  if ((await nextProjectionStatus(schedulerDb, stationId)) === "pending") {
    await enqueueJob(schedulerDb, stationId, "project_changesets", "changeset");
  }
}

export async function jobsLoop(say: Say, sayError: Say): Promise<never> {
  try {
    const n = await failInterruptedJobs(schedulerDb, stationId);
    if (n) say(`[jobs] marked ${n} job(s) interrupted by the last restart as failed.`);
  } catch (err) {
    sayError("[jobs] could not clear interrupted jobs:", err);
  }
  let lastPrune = 0;
  while (true) {
    try {
      const now = new Date();
      await scheduleRoutine(now);
      if (now.getTime() - lastPrune > 86_400_000) {
        await pruneJobs(schedulerDb, stationId, KEEP_SCHEDULED_DAYS, now);
        lastPrune = now.getTime();
      }
      const job = await claimNextJob(schedulerDb, stationId);
      if (job) {
        say(`[jobs] ${job.kind} started (asked by ${job.requestedBy}).`);
        const result = await runJob(job);
        await finishJob(schedulerDb, job.id, result);
        (result.ok ? say : sayError)(`[jobs] ${job.kind} ${result.ok ? "done" : "FAILED"}: ${result.summary}`);
        continue; // straight to the next one, if any
      }
    } catch (err) {
      sayError("[jobs] loop error (continuing):", err);
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}
