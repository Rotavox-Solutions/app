import { NextResponse } from "next/server";
import { revokeRunnerKey } from "@rotavox/schema";
import { db } from "@/lib/db";
import { stationRoute } from "@/lib/auth";

/** Revoke a Runner key. A Runner still using it is refused from its next call. */
export const DELETE = stationRoute<{ keyId: string }>("manage_station", async (_request, { stationId }, { keyId }) => {
  if (!(await revokeRunnerKey(db, stationId, keyId))) {
    return NextResponse.json({ error: "not_found", message: "No such key." }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
});
