import { eq } from "drizzle-orm";
import { logs } from "@rotavox/schema";
import { beforeEach, describe, expect, it } from "vitest";
import { generateNextHours, HorizonConflictError } from "../src/lib/generation";
import { db } from "../src/lib/db";
import { HOUR_MS } from "../src/lib/constants";
import { resetDb } from "./helpers/db";
import { seedLog, seedStation } from "./helpers/fixtures";

describe("generation idempotency", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("generates a log and persists it as draft", async () => {
    const station = await seedStation();

    const result = await generateNextHours(station.id, 2);

    const [log] = await db.select().from(logs).where(eq(logs.id, result.logId));
    expect(log).toBeDefined();
    expect(log.status).toBe("draft");
    expect(result.itemCount).toBe(0); // no clocks/grid seeded — engine skips every hour, that's fine for this test
  });

  it("rejects a second call whose horizon overlaps the first; no duplicate row is created", async () => {
    const station = await seedStation();
    const first = await generateNextHours(station.id, 24);
    const [firstLog] = await db.select().from(logs).where(eq(logs.id, first.logId));

    await expect(generateNextHours(station.id, 2, { start: firstLog.startsAt })).rejects.toThrow(HorizonConflictError);

    const allLogs = await db.select().from(logs).where(eq(logs.stationId, station.id));
    expect(allLogs).toHaveLength(1);
  });

  it("horizon start resolves to max(now, existing log's ends_at), not now alone", async () => {
    const station = await seedStation();
    const farFutureEnd = new Date(Math.ceil((Date.now() + 10 * HOUR_MS) / HOUR_MS) * HOUR_MS);
    const existing = await seedLog(station.id, {
      startsAt: new Date(farFutureEnd.getTime() - HOUR_MS),
      endsAt: farFutureEnd,
    });

    const result = await generateNextHours(station.id, 1);

    const [newLog] = await db.select().from(logs).where(eq(logs.id, result.logId));
    // Compare against the seeded row's own round-tripped endsAt (not a
    // locally-constructed Date) — the `timestamp` (no-tz) columns depend on the
    // reading process's local clock to reconstitute a Date, so comparing two
    // values that went through the identical read path cancels that out rather
    // than asserting an exact instant that's sensitive to the host's timezone.
    expect(newLog.startsAt.getTime()).toBe(existing.endsAt.getTime());
  });
});
