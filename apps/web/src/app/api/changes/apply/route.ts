import { applyDraft, enqueueJob, nextProjectionStatus } from "@rotavox/schema";
import { db } from "@/lib/db";
import { stationRoute } from "@/lib/auth";
import { changesetResponse, readJson } from "@/lib/changeset-http";

/**
 * Apply the draft: { intent? } — falls back to the intent saved on the draft. Where the
 * station projects to RadioDJ, the Runner is asked to write it straight away; applying a
 * reviewed change is the confirmation that write needs.
 */
export const POST = stationRoute("edit_music", async (request, { stationId, user }) => {
  const body = await readJson(request);
  return changesetResponse(async () => {
    const result = await applyDraft(db, stationId, {
      intent: typeof body.intent === "string" ? body.intent : undefined,
      appliedBy: user.id,
    });
    if ((await nextProjectionStatus(db, stationId)) === "pending") {
      await enqueueJob(db, stationId, "project_changesets", "changeset", user.id);
    }
    return result;
  });
});
