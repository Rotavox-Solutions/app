// The Runner updating itself (cloud split step 5): Rotavox staff press "Update Runner" in
// the staff console, which queues an update_runner job. The Runner brings its box to the
// commit the cloud runs, so the two always speak the same Runner API.
//
// The Runner can't do the update itself: it restarts the Runner's own service, and NSSM
// stops everything the service started along with it. So the job writes what to update to
// in runner-update.json and starts the "Rotavox Update" scheduled task, which runs
// `rotavox.ps1 self-update` as SYSTEM (tools/install-services.ps1 defines it). That fetches
// from GitHub, fast-forwards to the commit, installs and restarts in the safe order, and
// writes runner-update-result.json before the restart.
//
// Rotavox only names the commit. The code comes from GitHub's main, and only ever forward,
// so Rotavox can't hand a box code of its own.
//
// Who reports the job:
// - Success: the update restarts the Runner, so the new one reports it at startup and
//   checks it really is running the commit it was asked for.
// - Failure: the services aren't restarted, so this Runner, still waiting, reports it.
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { REVISION_PATTERN, sameRevision, shortRevision } from "@rotavox/schema";
import { api, RUNNER_REVISION, RUNNER_VERSION, SchedulerApiError } from "./scheduler.js";
import type { ApplyLog } from "./apply-changeset.js";

const run = promisify(execFile);

export const UPDATE_TASK = "Rotavox Update";
export const UPDATE_REQUEST_PATH = path.resolve(import.meta.dirname, "../runner-update.json");
export const UPDATE_RESULT_PATH = path.resolve(import.meta.dirname, "../runner-update-result.json");
/** The task takes the request file as soon as it starts; one still here after this never started. */
const TASK_START_MS = 2 * 60_000;
/** Longest an update with a dependency install should take, before giving up on the task. */
const UPDATE_WAIT_MS = 30 * 60_000;
const POLL_MS = 5_000;

export interface UpdateResult {
  jobId: string;
  ok: boolean;
  revision: string;
  fromVersion?: string;
  summary: string;
  output: string;
}

type JobResult = { ok: boolean; summary: string; output: string };

async function readResult(file = UPDATE_RESULT_PATH): Promise<UpdateResult | null> {
  try {
    // Windows PowerShell 5.1 writes UTF-8 with a byte-order mark.
    return JSON.parse((await readFile(file, "utf8")).replace(/^﻿/, "")) as UpdateResult;
  } catch {
    return null;
  }
}

async function taskExists(): Promise<boolean> {
  try {
    await run("schtasks", ["/Query", "/TN", UPDATE_TASK]);
    return true;
  } catch {
    return false;
  }
}

export async function updateRunner(jobId: string, log: ApplyLog): Promise<JobResult> {
  const { revision: target } = await api("whoami");
  if (!target || !REVISION_PATTERN.test(target)) {
    return {
      ok: false,
      summary: "Rotavox didn't say which commit it runs, so there's nothing to update to.",
      output: "",
    };
  }
  if (sameRevision(RUNNER_REVISION, target)) {
    return { ok: true, summary: `Already at ${shortRevision(target)}, as Rotavox is`, output: "" };
  }
  if (process.platform !== "win32") {
    return { ok: false, summary: "Self-update runs only on a Windows broadcast box.", output: "" };
  }
  if (!(await taskExists())) {
    return {
      ok: false,
      summary: `This box has no "${UPDATE_TASK}" task yet. Installing it is a one-time install step: run tools\\install-services.ps1 elevated on the box.`,
      output: "",
    };
  }

  await rm(UPDATE_RESULT_PATH, { force: true });
  await writeFile(
    UPDATE_REQUEST_PATH,
    JSON.stringify({ jobId, revision: target, fromVersion: RUNNER_VERSION, fromRevision: RUNNER_REVISION }),
  );
  await run("schtasks", ["/Run", "/TN", UPDATE_TASK]);
  log.info(
    `Asked the "${UPDATE_TASK}" task to update ${RUNNER_REVISION?.slice(0, 7) ?? "this box"} to ${shortRevision(target)}.`,
  );

  const started = Date.now();
  while (Date.now() - started < UPDATE_WAIT_MS) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    if (Date.now() - started > TASK_START_MS && existsSync(UPDATE_REQUEST_PATH)) {
      await rm(UPDATE_REQUEST_PATH, { force: true });
      return {
        ok: false,
        summary: `The "${UPDATE_TASK}" task didn't start within 2 minutes. Nothing changed.`,
        output: "",
      };
    }
    const result = await readResult();
    // A good result means the restart is moments away; the new Runner reports it.
    if (result?.jobId === jobId && !result.ok) {
      await rm(UPDATE_RESULT_PATH, { force: true });
      return { ok: false, summary: result.summary, output: result.output };
    }
  }
  return {
    ok: false,
    summary: `The update didn't finish within ${UPDATE_WAIT_MS / 60_000} minutes; see logs\\RotavoxUpdate.log on the box.`,
    output: "",
  };
}

/**
 * At startup, and on each pass of the job loop: report an update that restarted this Runner.
 * Runs before interrupted jobs are failed, so the update's job isn't mistaken for one. The
 * file stays until Rotavox has the result, so an outage at startup only delays the report.
 */
export async function reportFinishedUpdate(
  say: (...args: unknown[]) => void,
  file = UPDATE_RESULT_PATH,
): Promise<void> {
  if (!existsSync(file)) return;
  const r = await readResult(file);
  if (!r?.jobId) {
    await rm(file, { force: true });
    return;
  }
  const arrived = sameRevision(RUNNER_REVISION, r.revision);
  const ok = r.ok && arrived;
  const summary = !r.ok
    ? r.summary
    : arrived
      ? `Updated to ${shortRevision(r.revision)}: Runner ${r.fromVersion ?? "?"} → ${RUNNER_VERSION}`
      : `The update reported success, but the Runner restarted at ${RUNNER_REVISION?.slice(0, 7) ?? "an unknown commit"}, not ${shortRevision(r.revision)}`;
  try {
    await api("finishJob", { jobId: r.jobId, ok, summary, output: r.output ?? "" });
  } catch (err) {
    // Any other failure is retried; a job Rotavox no longer has never will be.
    if (!(err instanceof SchedulerApiError && err.status === 404)) throw err;
  }
  await rm(file, { force: true });
  say(`[jobs] update_runner ${ok ? "done" : "FAILED"}: ${summary}`);
}
