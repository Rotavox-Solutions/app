// The Runner's job loop: does what the UI asks for on the broadcast box (ADR-0001
// invariant #4 — the web app queues work, the Runner does it). Rotavox also queues the
// routine work nobody has to ask for, as part of handing out the next job: a library
// sync every 15 minutes, and writing applied changes to RadioDJ.
//
// Runs inside the pacer process, beside the pace loop. It must never take the pacer down,
// so every failure stays inside a job and is recorded on it.
import type { RunnerJob } from "@rotavox/schema";
import { api } from "./scheduler.js";
import { syncLibrary } from "./sync-library.js";
import { projectChangesets } from "./project-changesets.js";
import type { ApplyLog } from "./apply-changeset.js";

const POLL_MS = 5_000;
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

export async function jobsLoop(say: Say, sayError: Say): Promise<never> {
  try {
    const { failed: n } = await api("failInterruptedJobs");
    if (n) say(`[jobs] marked ${n} job(s) interrupted by the last restart as failed.`);
  } catch (err) {
    sayError("[jobs] could not clear interrupted jobs:", err);
  }
  let lastPrune = 0;
  while (true) {
    try {
      const now = new Date();
      if (now.getTime() - lastPrune > 86_400_000) {
        await api("pruneJobs", { now });
        lastPrune = now.getTime();
      }
      const job = await api("nextJob", { now });
      if (job) {
        say(`[jobs] ${job.kind} started (asked by ${job.requestedBy}).`);
        const result = await runJob(job);
        await api("finishJob", { jobId: job.id, ...result });
        (result.ok ? say : sayError)(`[jobs] ${job.kind} ${result.ok ? "done" : "FAILED"}: ${result.summary}`);
        continue; // straight to the next one, if any
      }
    } catch (err) {
      sayError("[jobs] loop error (continuing):", err);
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}
