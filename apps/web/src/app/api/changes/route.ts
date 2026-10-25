import { ChangesetError, discardDraft, stageChanges, type LifecycleState } from "@rotavox/schema";
import { db } from "@/lib/db";
import { stationRoute } from "@/lib/auth";
import { changesetResponse, readJson } from "@/lib/changeset-http";

/** Stage placement changes into the draft: { items: [{ songId, state, categoryId, reason? }] }. */
export const POST = stationRoute("edit_music", async (request, { stationId }) => {
  const body = await readJson(request);
  return changesetResponse(async () => {
    if (!Array.isArray(body.items)) throw new ChangesetError("invalid", "items must be an array");
    const requests = body.items.map((raw: unknown) => {
      const i = (raw ?? {}) as Record<string, unknown>;
      if (typeof i.songId !== "string" || typeof i.state !== "string") {
        throw new ChangesetError("invalid", "each item needs a songId and a state");
      }
      return {
        songId: i.songId,
        to: { state: i.state as LifecycleState, categoryId: typeof i.categoryId === "string" ? i.categoryId : null },
        reason: typeof i.reason === "string" ? i.reason : undefined,
      };
    });
    const draft = await stageChanges(db, stationId, requests);
    return { changesetId: draft.id, itemCount: draft.items.length };
  });
});

/** Discard the draft. */
export const DELETE = stationRoute("edit_music", async (_request, { stationId }) =>
  changesetResponse(() => discardDraft(db, stationId)),
);
