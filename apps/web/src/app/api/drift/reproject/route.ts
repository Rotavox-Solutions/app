import { enqueueJob, nextProjectionStatus, reprojectDrift } from "@rotavox/schema";
import { db } from "@/lib/db";
import { stationRoute } from "@/lib/auth";
import { changesetResponse, readJson } from "@/lib/changeset-http";

/**
 * Put RadioDJ back in line with Rotavox for drifted songs: { songIds }. Queues the
 * Runner's projection, the same write an applied change gets.
 */
export const POST = stationRoute("edit_music", async (request, { stationId, user }) => {
  const body = await readJson(request);
  return changesetResponse(async () => {
    const songIds = Array.isArray(body.songIds) ? body.songIds.filter((s): s is string => typeof s === "string") : [];
    const result = await reprojectDrift(db, stationId, songIds, { appliedBy: user.id });
    const next = await nextProjectionStatus(db, stationId);
    if (result.songs && next === "pending") await enqueueJob(db, stationId, "project_changesets", "changeset", user.id);
    // A failed write at the head of the line holds everything behind it until it's retried.
    return { ...result, blocked: next === "failed" };
  });
});
