import { ChangesetError, setRestReviewDays } from "@rotavox/schema";
import { db } from "@/lib/db";
import { stationRoute } from "@/lib/auth";
import { changesetResponse, readJson } from "@/lib/changeset-http";

/** A pool's standard rest: { days: number | null }. Null removes it. */
export const PUT = stationRoute<{ categoryId: string }>("edit_music", async (request, { stationId }, { categoryId }) => {
  const body = await readJson(request);
  return changesetResponse(async () => {
    if (body.days !== null && typeof body.days !== "number") {
      throw new ChangesetError("invalid", "days must be a number or null");
    }
    await setRestReviewDays(db, stationId, categoryId, body.days as number | null);
  });
});
