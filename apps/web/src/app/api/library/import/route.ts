import { NextResponse } from "next/server";
import { applyImport } from "@rotavox/schema";
import { db } from "@/lib/db";
import { stationRoute } from "@/lib/auth";
import { changesetResponse, readJson } from "@/lib/changeset-http";
import { ImportRequestError, planFromRequest } from "@/lib/library-import";

/** Import a library file: { csv, mapping }. The plan is worked out again here, not trusted from the client. */
export const POST = stationRoute("edit_music", async (request, { stationId }) => {
  const body = await readJson(request);
  try {
    const plan = await planFromRequest(stationId, body);
    return changesetResponse(() => applyImport(db, stationId, plan));
  } catch (err) {
    if (err instanceof ImportRequestError) return NextResponse.json({ error: "invalid", message: err.message }, { status: 400 });
    throw err;
  }
});
