import { draftRevert } from "@rotavox/schema";
import { db } from "@/lib/db";
import { stationRoute } from "@/lib/auth";
import { changesetResponse } from "@/lib/changeset-http";

/** Draft the undo of an applied changeset. It is reviewed and applied like any other. */
export const POST = stationRoute<{ changesetId: string }>(
  "edit_music",
  async (_request, { stationId }, { changesetId }) =>
    changesetResponse(async () => {
      const draft = await draftRevert(db, stationId, changesetId);
      return { changesetId: draft.id, itemCount: draft.items.length };
    }),
);
