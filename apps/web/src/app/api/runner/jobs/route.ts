import { NextResponse } from "next/server";
import { enqueueJob, JOB_KINDS, type JobKind } from "@rotavox/schema";
import { db } from "@/lib/db";
import { stationId } from "@/lib/station";
import { readJson } from "@/lib/changeset-http";

/** Ask the Runner to do something on the broadcast box: { kind: "sync_library" | "project_changesets" }. */
export async function POST(request: Request) {
  const body = await readJson(request);
  if (typeof body.kind !== "string" || !JOB_KINDS.includes(body.kind as JobKind)) {
    return NextResponse.json({ error: "invalid", message: `kind must be one of ${JOB_KINDS.join(", ")}` }, { status: 400 });
  }
  const job = await enqueueJob(db, stationId, body.kind as JobKind, "ui");
  return NextResponse.json({ jobId: job.id, status: job.status });
}
