import {
  ChangesetError,
  POOL_LIFECYCLE_LIMITS,
  POOL_LIFECYCLE_REFS,
  setPoolLifecycle,
  type PoolLifecycleSettings,
} from "@rotavox/schema";
import { db } from "@/lib/db";
import { stationRoute } from "@/lib/auth";
import { changesetResponse, readJson } from "@/lib/changeset-http";

/**
 * A pool's lifecycle settings: any of { restReviewDays, ladderRank, fallingAfterDays,
 * promoteAfterDays, benchAfterUnairedDays } (numbers) and { restExitCategoryId,
 * promoteToCategoryId } (pool ids), each or null.
 */
export const PUT = stationRoute<{ categoryId: string }>("edit_music", async (request, { stationId }, { categoryId }) => {
  const body = await readJson(request);
  return changesetResponse(async () => {
    const settings: PoolLifecycleSettings = {};
    for (const field of Object.keys(POOL_LIFECYCLE_LIMITS) as (keyof typeof POOL_LIFECYCLE_LIMITS)[]) {
      if (!(field in body)) continue;
      const v = body[field];
      if (v !== null && typeof v !== "number") throw new ChangesetError("invalid", `${field} must be a number or null`);
      settings[field] = v;
    }
    for (const field of Object.keys(POOL_LIFECYCLE_REFS) as (keyof typeof POOL_LIFECYCLE_REFS)[]) {
      if (!(field in body)) continue;
      const v = body[field];
      if (v !== null && typeof v !== "string") throw new ChangesetError("invalid", `${field} must be a pool id or null`);
      settings[field] = v;
    }
    await setPoolLifecycle(db, stationId, categoryId, settings);
  });
});
