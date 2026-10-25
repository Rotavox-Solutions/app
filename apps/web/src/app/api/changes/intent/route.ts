import { ChangesetError, setDraftIntent } from "@rotavox/schema";
import { db } from "@/lib/db";
import { stationId } from "@/lib/station";
import { changesetResponse, readJson } from "@/lib/changeset-http";

/** Save the draft's intent as it is typed, so it survives a reload: { intent }. */
export async function PUT(request: Request) {
  const body = await readJson(request);
  return changesetResponse(async () => {
    if (typeof body.intent !== "string") throw new ChangesetError("invalid", "intent must be a string");
    await setDraftIntent(db, stationId, body.intent);
  });
}
