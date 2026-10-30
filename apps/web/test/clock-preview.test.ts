import { beforeEach, describe, expect, it } from "vitest";
import { clockPositions, formatGrid, getClockForEdit, logs, songCategories } from "@rotavox/schema";
import { eq } from "drizzle-orm";
import { db } from "../src/lib/db";
import { previewClock } from "../src/lib/clock-preview";
import { resetDb } from "./helpers/db";
import { seedCategory, seedClock, seedClockPosition, seedSong, seedStation } from "./helpers/fixtures";

describe("clock preview", () => {
  beforeEach(resetDb);

  it("generates the saved clock and a draft side by side, in memory", async () => {
    const station = await seedStation({ membershipImportedAt: new Date() });
    const a = await seedCategory(station.id, { name: "A" });
    const b = await seedCategory(station.id, { name: "B" });
    for (let i = 0; i < 40; i++) {
      const s = await seedSong(station.id, i + 1, { artist: `Artist ${i}`, title: `Song ${i}`, durationMs: 240_000 });
      await db.insert(songCategories).values({ songId: s.id, categoryId: i % 2 ? a.id : b.id });
    }
    const clock = await seedClock(station.id, { name: "Test" });
    for (let i = 0; i < 15; i++) {
      await seedClockPosition(clock.id, { sortOrder: i + 1, positionType: "category", categoryId: i % 2 ? a.id : b.id });
    }
    // The real grid plays something else entirely; the preview plays only this clock.
    const other = await seedClock(station.id, { name: "Other" });
    await db.insert(formatGrid).values({ stationId: station.id, dayOfWeek: 1, hour: 6, clockId: other.id });

    const loaded = (await getClockForEdit(db, station.id, clock.id))!;
    const { id: _id, updatedAt: _u, ...draft } = loaded;
    const shorter = { ...draft, positions: draft.positions.slice(0, 10) };
    const preview = (await previewClock(station.id, clock.id, shorter, 3))!;

    expect(preview.saved.hours).toHaveLength(3);
    expect(preview.draft.hours).toHaveLength(3);
    // 15 × 4:00 is a full hour; 10 × 4:00 is 40 minutes.
    expect(preview.saved.median).toBeCloseTo(60, 0);
    expect(preview.draft.median).toBeCloseTo(40, 0);
    expect(preview.draft.outOfTolerance).toBe(3);
    expect(preview.draft.hours[0].running[0]).toMatchObject({ position: 1, category: "B", durationMs: 240_000 });

    // Nothing written.
    expect(await db.select().from(clockPositions).where(eq(clockPositions.clockId, clock.id))).toHaveLength(15);
    expect(await db.select().from(logs)).toHaveLength(0);
  });

  it("returns nothing for another station's clock", async () => {
    const station = await seedStation();
    const other = await seedStation({ name: "Other" });
    const clock = await seedClock(other.id);
    expect(await previewClock(station.id, clock.id, { name: "x", lengthMinutes: 60, notes: null, positions: [] }, 1)).toBeNull();
  });
});
