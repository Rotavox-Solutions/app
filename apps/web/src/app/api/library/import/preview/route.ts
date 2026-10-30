import { NextResponse } from "next/server";
import { categories, stationHasRunner } from "@rotavox/schema";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { stationRoute } from "@/lib/auth";
import { readJson } from "@/lib/changeset-http";
import { ImportRequestError, planFromRequest } from "@/lib/library-import";

const SHOWN = 100;

/** What importing this file would do: { csv, mapping? }. Writes nothing. */
export const POST = stationRoute("edit_music", async (request, { stationId }) => {
  const body = await readJson(request);
  try {
    const plan = await planFromRequest(stationId, body);
    // Changes first, so the rows worth checking are the ones shown.
    const order = { skip: 0, create: 1, update: 2, unchanged: 3 } as const;
    const rows = [...plan.rows].sort((a, b) => order[a.action] - order[b.action] || a.line - b.line).slice(0, SHOWN);
    return NextResponse.json({
      header: plan.header,
      mapping: plan.mapping,
      counts: plan.counts,
      notInFile: plan.notInFile,
      matchBy: plan.matchBy,
      problems: plan.problems,
      rows,
      hasRunner: await stationHasRunner(db, stationId),
      unknownPools: await unknownPools(stationId, plan.rows),
    });
  } catch (err) {
    if (err instanceof ImportRequestError) return NextResponse.json({ error: "invalid", message: err.message }, { status: 400 });
    throw err;
  }
});

/** Pool names new songs give that match no pool here: those songs go to the Inbox. */
async function unknownPools(stationId: string, rows: { action: string; song: { pool: string | null } }[]) {
  const names = new Set(
    (await db.select({ name: categories.name }).from(categories).where(eq(categories.stationId, stationId))).map((c) => c.name.toLowerCase())
  );
  const counts = new Map<string, number>();
  for (const r of rows) {
    if (r.action !== "create" || !r.song.pool || names.has(r.song.pool.toLowerCase())) continue;
    counts.set(r.song.pool, (counts.get(r.song.pool) ?? 0) + 1);
  }
  return [...counts].map(([name, songs]) => ({ name, songs }));
}
