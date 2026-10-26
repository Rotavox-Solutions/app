import { createRunnerKey } from "@rotavox/schema";
import { db } from "@/lib/db";
import { accountResponse, stationRoute } from "@/lib/auth";
import { readJson } from "@/lib/changeset-http";

/** Make a key for this station's Runner: { label }. The key is in the response and nowhere else. */
export const POST = stationRoute("manage_station", async (request, { stationId, user }) => {
  const body = await readJson(request);
  return accountResponse(async () => {
    const { key, row } = await createRunnerKey(db, { stationId, label: String(body.label ?? ""), createdBy: user.id });
    return { key, label: row.label };
  });
});
