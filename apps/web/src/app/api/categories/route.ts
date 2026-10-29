import { createCategory } from "@rotavox/schema";
import { db } from "@/lib/db";
import { stationRoute } from "@/lib/auth";
import { changesetResponse, readJson } from "@/lib/changeset-http";

/** A new category: { name, kind: "music" | "imaging", rdjSubcategoryId?: number }. */
export const POST = stationRoute("edit_music", async (request, { stationId }) => {
  const body = await readJson(request);
  return changesetResponse(async () => {
    const row = await createCategory(db, stationId, {
      name: typeof body.name === "string" ? body.name : "",
      kind: typeof body.kind === "string" ? body.kind : "",
      rdjSubcategoryId: typeof body.rdjSubcategoryId === "number" ? body.rdjSubcategoryId : null,
    });
    return { id: row.id, name: row.name };
  });
});
