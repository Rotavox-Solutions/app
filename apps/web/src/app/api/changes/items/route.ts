import { ChangesetError, unstage } from "@rotavox/schema";
import { db } from "@/lib/db";
import { stationId } from "@/lib/station";
import { changesetResponse, readJson } from "@/lib/changeset-http";

/** Take songs back out of the draft: { songIds: [...] }. */
export async function DELETE(request: Request) {
  const body = await readJson(request);
  return changesetResponse(async () => {
    if (!Array.isArray(body.songIds) || !body.songIds.every((s) => typeof s === "string")) {
      throw new ChangesetError("invalid", "songIds must be an array of ids");
    }
    await unstage(db, stationId, body.songIds as string[]);
  });
}
