import { NextResponse } from "next/server";
import { importMembership } from "@rotavox/schema";
import { db } from "@/lib/db";
import { stationId } from "@/lib/station";
import { readJson } from "@/lib/changeset-http";

/**
 * Hand pool membership to Rotavox (ADR-0002 §4): { apply: boolean } — a preview unless
 * apply is true. Postgres only: it reads the mirror, never RadioDJ, so the web app may run it.
 */
export async function POST(request: Request) {
  const body = await readJson(request);
  try {
    const summary = await importMembership(db, stationId, { dryRun: body.apply !== true });
    return NextResponse.json(summary);
  } catch (err) {
    return NextResponse.json({ error: "invalid", message: (err as Error).message }, { status: 400 });
  }
}
