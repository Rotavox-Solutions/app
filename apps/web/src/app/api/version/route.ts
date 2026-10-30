import { NextResponse } from "next/server";
import { serverRevision } from "@rotavox/schema";
import { publicRoute } from "@/lib/auth";

/** The commit this server runs, so a page left open can tell it has been deployed over. */
export const GET = publicRoute(async () =>
  NextResponse.json({ revision: serverRevision() }, { headers: { "Cache-Control": "no-store" } })
);
