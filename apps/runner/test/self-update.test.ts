import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sameRevision } from "@rotavox/schema";
import { readRevision } from "../src/revision.js";

const FULL = "fc96ac3e1b2a4c5d6e7f8091a2b3c4d5e6f70819";
const OLD = "051e0e2aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

const api = vi.fn();
vi.mock("../src/scheduler.js", () => {
  class SchedulerApiError extends Error {
    constructor(
      readonly op: string,
      readonly status: number,
      message: string,
    ) {
      super(message);
    }
  }
  return {
    api,
    SchedulerApiError,
    RUNNER_VERSION: "0.6.0",
    RUNNER_REVISION: "fc96ac3e1b2a4c5d6e7f8091a2b3c4d5e6f70819",
  };
});
const { reportFinishedUpdate } = await import("../src/self-update.js");
const { SchedulerApiError } = await import("../src/scheduler.js");

const tmp = () => mkdtempSync(path.join(tmpdir(), "rotavox-update-"));

describe("the Runner's own commit", () => {
  it("reads a branch's loose ref, a packed ref, and a detached HEAD", () => {
    const loose = tmp();
    mkdirSync(path.join(loose, ".git/refs/heads"), { recursive: true });
    writeFileSync(path.join(loose, ".git/HEAD"), "ref: refs/heads/main\n");
    writeFileSync(path.join(loose, ".git/refs/heads/main"), FULL + "\n");
    expect(readRevision(loose)).toBe(FULL);

    const packed = tmp();
    mkdirSync(path.join(packed, ".git"));
    writeFileSync(path.join(packed, ".git/HEAD"), "ref: refs/heads/main\n");
    writeFileSync(
      path.join(packed, ".git/packed-refs"),
      `# pack-refs with: peeled\n${OLD} refs/heads/other\n${FULL} refs/heads/main\n`,
    );
    expect(readRevision(packed)).toBe(FULL);

    const detached = tmp();
    mkdirSync(path.join(detached, ".git"));
    writeFileSync(path.join(detached, ".git/HEAD"), FULL + "\n");
    expect(readRevision(detached)).toBe(FULL);

    expect(readRevision(tmp())).toBeNull();
  });

  it("matches a short commit id to its full one, and nothing shorter than 7", () => {
    expect(sameRevision(FULL, "fc96ac3e1b2a")).toBe(true);
    expect(sameRevision("fc96ac3", FULL)).toBe(true);
    expect(sameRevision(FULL, OLD)).toBe(false);
    expect(sameRevision("fc9", FULL)).toBe(false);
    expect(sameRevision(null, FULL)).toBe(false);
  });
});

describe("reporting an update after the restart", () => {
  beforeEach(() => api.mockReset());

  function resultFile(r: object): string {
    const file = path.join(tmp(), "runner-update-result.json");
    // As PowerShell 5.1 writes it: UTF-8 with a byte-order mark.
    writeFileSync(file, "﻿" + JSON.stringify(r));
    return file;
  }
  const say = () => {};

  it("reports success once this Runner is the commit it was asked for", async () => {
    const file = resultFile({
      jobId: "j1",
      ok: true,
      revision: "fc96ac3e1b2a",
      fromVersion: "0.5.0",
      summary: "Updated",
      output: "log",
    });
    await reportFinishedUpdate(say, file);
    expect(api).toHaveBeenCalledWith("finishJob", {
      jobId: "j1",
      ok: true,
      summary: "Updated to fc96ac3: Runner 0.5.0 → 0.6.0",
      output: "log",
    });
    expect(existsSync(file)).toBe(false);
  });

  it("fails it when the Runner came back on another commit", async () => {
    const file = resultFile({ jobId: "j2", ok: true, revision: OLD, summary: "Updated", output: "" });
    await reportFinishedUpdate(say, file);
    expect(api.mock.calls[0][1]).toMatchObject({
      ok: false,
      summary: expect.stringMatching(/restarted at fc96ac3, not 051e0e2/),
    });
  });

  it("passes a failed update's reason through", async () => {
    const file = resultFile({ jobId: "j3", ok: false, revision: OLD, summary: "Update failed: npm ci", output: "x" });
    await reportFinishedUpdate(say, file);
    expect(api.mock.calls[0][1]).toMatchObject({ ok: false, summary: "Update failed: npm ci" });
  });

  it("keeps the result while Rotavox is unreachable, and drops it for a job Rotavox no longer has", async () => {
    const file = resultFile({ jobId: "j4", ok: true, revision: FULL, summary: "", output: "" });
    api.mockRejectedValueOnce(new SchedulerApiError("finishJob", 0, "unreachable"));
    await expect(reportFinishedUpdate(say, file)).rejects.toThrow();
    expect(existsSync(file)).toBe(true);
    api.mockRejectedValueOnce(new SchedulerApiError("finishJob", 404, "no job"));
    await reportFinishedUpdate(say, file);
    expect(existsSync(file)).toBe(false);
  });

  it("does nothing when no update happened", async () => {
    await reportFinishedUpdate(say, path.join(tmp(), "absent.json"));
    expect(api).not.toHaveBeenCalled();
  });
});
