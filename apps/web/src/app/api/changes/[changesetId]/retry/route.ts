import { enqueueJob, retryProjection } from "@rotavox/schema";
import { db } from "@/lib/db";
import { stationId } from "@/lib/station";
import { changesetResponse } from "@/lib/changeset-http";

/**
 * Try a failed RadioDJ write again. A sync goes first: the usual cause is a song changed
 * in RadioDJ directly, and the write's precondition is what the mirror last saw.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ changesetId: string }> }) {
  const { changesetId } = await params;
  return changesetResponse(async () => {
    await retryProjection(db, stationId, changesetId);
    await enqueueJob(db, stationId, "sync_library", "ui");
    await enqueueJob(db, stationId, "project_changesets", "ui");
  });
}
