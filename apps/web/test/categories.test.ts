import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  categories,
  ChangesetError,
  createCategory,
  decodeWire,
  encodeWire,
  listUnmappedSubcategories,
  runRunnerOp,
  stations,
} from "@rotavox/schema";
import { db } from "../src/lib/db";
import { getInbox } from "../src/lib/music-edits";
import { resetDb } from "./helpers/db";
import { seedCategory, seedSong, seedStation } from "./helpers/fixtures";

const SUBCATS: { id: number; name: string; parent: string | null }[] = [
  { id: 38, name: "New-Music Sweepers", parent: "Sweepers" },
  { id: 39, name: "New-Music Trail", parent: "Sweepers" },
  { id: 31, name: "Z", parent: "Music" },
  { id: 53, name: "Front-sell", parent: "Sweepers" },
  { id: 5, name: "A1", parent: "Music" },
];

async function syncNames(stationId: string, subcategories = SUBCATS) {
  return decodeWire(await runRunnerOp(db, stationId, "syncSubcategories", encodeWire({ subcategories })));
}

describe("making categories", () => {
  beforeEach(resetDb);

  it("lists RadioDJ subcategories with no category and no lifecycle meaning, with the songs waiting in each", async () => {
    const station = await seedStation();
    await db
      .update(stations)
      .set({ rdjLifecycleSubcats: { "31": { state: "benched" } }, membershipImportedAt: new Date() })
      .where(eq(stations.id, station.id));
    await seedCategory(station.id, { name: "New-Music Sweepers", kind: "imaging", rdjSubcategoryIds: [38] });
    await seedCategory(station.id, { name: "A1", rdjSubcategoryIds: [5] });
    await seedSong(station.id, 1891, { rdjSubcategoryId: 39 });
    await seedSong(station.id, 1892, { rdjSubcategoryId: 39 });
    await syncNames(station.id);

    expect(await listUnmappedSubcategories(db, station.id)).toEqual([
      { rdjSubcategoryId: 53, name: "Front-sell", parentName: "Sweepers", suggestedKind: "imaging", songs: 0 },
      { rdjSubcategoryId: 39, name: "New-Music Trail", parentName: "Sweepers", suggestedKind: "imaging", songs: 2 },
    ]);
  });

  it("makes one mapped to a subcategory, after which the Inbox suggests it for that subcategory's songs", async () => {
    const station = await seedStation();
    await db.update(stations).set({ membershipImportedAt: new Date() }).where(eq(stations.id, station.id));
    const song = await seedSong(station.id, 1891, { rdjSubcategoryId: 39 });
    await syncNames(station.id);

    const before = await getInbox(station.id);
    expect(before.songs.find((s) => s.id === song.id)?.suggested).toBeNull();

    const cat = await createCategory(db, station.id, {
      name: "New-Music Trail",
      kind: "imaging",
      rdjSubcategoryId: 39,
    });
    expect(cat).toMatchObject({ kind: "imaging", rdjSubcategoryIds: [39] });
    const after = await getInbox(station.id);
    expect(after.songs.find((s) => s.id === song.id)?.suggested).toEqual({ state: "active", categoryId: cat.id });
    expect(await listUnmappedSubcategories(db, station.id)).not.toContainEqual(
      expect.objectContaining({ rdjSubcategoryId: 39 }),
    );
  });

  it("refuses a duplicate name, a subcategory another category maps, and one RadioDJ doesn't have", async () => {
    const station = await seedStation();
    await seedCategory(station.id, { name: "A1", rdjSubcategoryIds: [5] });
    await syncNames(station.id);
    const attempt = (input: Parameters<typeof createCategory>[2]) => createCategory(db, station.id, input);

    await expect(attempt({ name: "a1", kind: "music" })).rejects.toThrow(/already a category called/);
    await expect(attempt({ name: "A1 again", kind: "music", rdjSubcategoryId: 5 })).rejects.toThrow(/A1 already maps/);
    await expect(attempt({ name: "Ghost", kind: "imaging", rdjSubcategoryId: 999 })).rejects.toThrow(
      /no such subcategory/,
    );
    await expect(attempt({ name: "  ", kind: "music" })).rejects.toBeInstanceOf(ChangesetError);
    await expect(attempt({ name: "Voice", kind: "voicetrack" })).rejects.toThrow(/kind must be/);

    // A station with no Runner makes categories with no mapping at all.
    expect(await attempt({ name: "Currents 2", kind: "music" })).toMatchObject({ rdjSubcategoryIds: null });
    expect((await db.select().from(categories).where(eq(categories.stationId, station.id))).length).toBe(2);
  });

  it("takes RadioDJ's names from each sync as a whole, and never another station's", async () => {
    const a = await seedStation({ name: "A" });
    const b = await seedStation({ name: "B" });
    await syncNames(a.id);
    await syncNames(a.id, [{ id: 39, name: "New-Music Trail (renamed)", parent: "Sweepers" }]);
    await syncNames(b.id, [{ id: 77, name: "Other", parent: null }]);
    expect((await listUnmappedSubcategories(db, a.id)).map((s) => [s.rdjSubcategoryId, s.name])).toEqual([
      [39, "New-Music Trail (renamed)"],
    ]);
    await expect(syncNames(a.id, [])).rejects.toThrow(/empty/);
  });
});
