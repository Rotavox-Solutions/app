import { enqueueJob, retryProjection } from "@rotavox/schema";
import { db } from "@/lib/db";
import { stationRoute } from "@/lib/auth";
import { changesetResponse } from "@/lib/changeset-http";

/**
 * Try a failed RadioDJ write again. A sync goes first: the usual cause is a song changed
 * in RadioDJ directly, and the write's precondition is what the mirror last saw.
 */
export const POST = stationRoute<{ changesetId: string }>(
  "edit_music",
  async (_request, { stationId, user }, { changesetId }) =>
    changesetResponse(async () => {
      await retryProjection(db, stationId, changesetId);
      await enqueueJob(db, stationId, "sync_library", "ui", user.id);
      await enqueueJob(db, stationId, "project_changesets", "ui", user.id);
    }),
);
