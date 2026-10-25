import { draftRevert } from "@rotavox/schema";
import { db } from "@/lib/db";
import { stationId } from "@/lib/station";
import { changesetResponse } from "@/lib/changeset-http";

/** Draft the undo of an applied changeset. It is reviewed and applied like any other. */
export async function POST(_request: Request, { params }: { params: Promise<{ changesetId: string }> }) {
  const { changesetId } = await params;
  return changesetResponse(async () => {
    const draft = await draftRevert(db, stationId, changesetId);
    return { changesetId: draft.id, itemCount: draft.items.length };
  });
}
