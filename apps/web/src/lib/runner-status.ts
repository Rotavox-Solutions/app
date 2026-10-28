// What the Runner is doing and has done, for the screens that ask it for work.
import { lastSucceeded, latestJobs, listRecentJobs, type JobKind, type RunnerJob } from "@rotavox/schema";
import { db } from "./db";

/** A queued job older than this means the Runner isn't polling. */
export const RUNNER_SILENT_SECONDS = 60;

export const JOB_LABEL: Record<JobKind, string> = {
  sync_library: "Library sync",
  project_changesets: "Write changes to RadioDJ",
  project_autodj_events: "AutoDJ fail-safe events",
};

export const REQUESTER_LABEL: Record<string, string> = {
  ui: "you",
  schedule: "schedule",
  changeset: "applied change",
};

export interface RunnerStatus {
  latest: Partial<Record<JobKind, RunnerJob>>;
  lastSync: Date | null;
  recent: RunnerJob[];
  /** Something is queued and has waited too long to be picked up. */
  runnerSilent: boolean;
  /** Something is queued or running — screens refresh themselves while this holds. */
  busy: boolean;
}

export async function getRunnerStatus(stationId: string, now: Date = new Date()): Promise<RunnerStatus> {
  const [latest, lastSync, recent] = await Promise.all([
    latestJobs(db, stationId),
    lastSucceeded(db, stationId, "sync_library"),
    listRecentJobs(db, stationId, 25),
  ]);
  const open = Object.values(latest).filter((j) => j && (j.status === "queued" || j.status === "running")) as RunnerJob[];
  return {
    latest,
    lastSync,
    recent,
    busy: open.length > 0,
    runnerSilent: open.some(
      (j) => j.status === "queued" && now.getTime() - j.requestedAt.getTime() > RUNNER_SILENT_SECONDS * 1000
    ),
  };
}
