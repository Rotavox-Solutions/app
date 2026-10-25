import { applyDraft } from "@rotavox/schema";
import { db } from "@/lib/db";
import { stationId } from "@/lib/station";
import { changesetResponse, readJson } from "@/lib/changeset-http";

/** Apply the draft: { intent? } — falls back to the intent saved on the draft. */
export async function POST(request: Request) {
  const body = await readJson(request);
  return changesetResponse(() =>
    applyDraft(db, stationId, { intent: typeof body.intent === "string" ? body.intent : undefined })
  );
}
