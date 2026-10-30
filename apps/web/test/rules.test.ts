import { beforeEach, describe, expect, it } from "vitest";
import { formatGrid, getRulesForEdit, listRuleRevisions, rules, saveRules, songCategories, type RuleDraft } from "@rotavox/schema";
import { asc, eq } from "drizzle-orm";
import { db } from "../src/lib/db";
import { previewRules } from "../src/lib/rules-preview";
import { resetDb } from "./helpers/db";
import { seedCategory, seedClock, seedClockPosition, seedSong, seedStation } from "./helpers/fixtures";

describe("rules editing", () => {
  beforeEach(resetDb);

  async function seed() {
    const station = await seedStation();
    const a1 = await seedCategory(station.id, { name: "A1" });
    await db.insert(rules).values([
      { stationId: station.id, scope: "global", ruleType: "artist_separation", params: { minMinutes: 45 }, hardness: "hard" },
      { stationId: station.id, scope: "global", ruleType: "era_spread", params: {}, hardness: "soft", weight: 0.15 },
    ]);
    return { station, a1, loaded: (await getRulesForEdit(db, station.id))! };
  }

  const newRule = (over: Partial<RuleDraft>): RuleDraft => ({
    id: null, key: `k-${Math.random()}`, ruleType: "title_separation", scope: "global", scopeRef: null,
    params: { minMinutes: 120 }, hardness: "hard", weight: null, ...over,
  });

  it("saves in place by id, keeps soft rules as they are, and keeps the original as a revision", async () => {
    const { station, a1, loaded } = await seed();
    const [artist, soft] = loaded.rules;
    expect(soft).toMatchObject({ ruleType: "era_spread", hardness: "soft" });
    const drafts = [
      { ...artist, params: { minMinutes: 60 } },
      soft,
      newRule({ ruleType: "max_per_hour", scope: "category", scopeRef: a1.id, params: { count: 3 } }),
    ];
    const r = await saveRules(db, station.id, drafts, { expectedUpdatedAt: loaded.updatedAt, userId: null, note: "Tighter" });
    expect(r).toMatchObject({ added: 1, removed: 0 });

    const rows = await db.select().from(rules).where(eq(rules.stationId, station.id)).orderBy(asc(rules.ruleType));
    expect(rows.map((x) => [x.ruleType, x.params])).toEqual([
      ["artist_separation", { minMinutes: 60 }],
      ["era_spread", {}],
      ["max_per_hour", { count: 3 }],
    ]);
    expect(rows.find((x) => x.ruleType === "artist_separation")!.id).toBe(artist.id);
    const revs = await listRuleRevisions(db, station.id);
    expect(revs.map((x) => x.note)).toEqual(["Tighter", "As they stood before the first edit in Rotavox"]);
    expect(revs[1].snapshot.rules).toHaveLength(2);

    await expect(saveRules(db, station.id, drafts, { expectedUpdatedAt: loaded.updatedAt, userId: null })).rejects.toMatchObject({
      code: "conflict",
    });
  });

  it("lists every problem and changes nothing", async () => {
    const { station, loaded } = await seed();
    const err = await saveRules(
      db,
      station.id,
      [
        ...loaded.rules,
        newRule({ ruleType: "artist_separation", params: { minMinutes: 30 } }),
        newRule({ ruleType: "max_per_hour", params: { count: 3 } }),
        newRule({ ruleType: "horizontal_separation", scope: "category", scopeRef: null, params: { windowHours: 0, minDays: 7 } }),
        newRule({ ruleType: "daypart_restrict", scope: "category", scopeRef: loaded.rules[0].id, params: {} }),
      ],
      { expectedUpdatedAt: loaded.updatedAt, userId: null }
    ).catch((e) => e);
    expect(err.problems).toEqual([
      "Artist separation station-wide is set twice; keep one.",
      "Most per hour station-wide: choose the category it limits.",
      "Horizontal separation: choose a category at this station.",
      "Horizontal separation for a category: the hour window must be a whole number, 1 to 12.",
      "Only in these hours: choose a category at this station.",
      "Only in these hours for a category: choose days, hours or both.",
    ]);
    expect(await db.select().from(rules).where(eq(rules.stationId, station.id))).toHaveLength(2);
  });

  it("previews the saved rules against a draft on the real grid", async () => {
    const station = await seedStation();
    const a = await seedCategory(station.id, { name: "A" });
    // Four artists, two songs each: a 45-minute artist window is easy, a 3-hour one is not.
    for (let i = 0; i < 8; i++) {
      const s = await seedSong(station.id, i + 1, { artist: `Artist ${i % 4}`, title: `Song ${i}`, durationMs: 240_000 });
      await db.insert(songCategories).values({ songId: s.id, categoryId: a.id });
    }
    const clock = await seedClock(station.id);
    for (let i = 0; i < 15; i++) await seedClockPosition(clock.id, { sortOrder: i + 1, positionType: "category", categoryId: a.id });
    const cells = [];
    for (let d = 0; d < 7; d++) for (let h = 0; h < 24; h++) cells.push({ stationId: station.id, dayOfWeek: d, hour: h, clockId: clock.id });
    await db.insert(formatGrid).values(cells);
    await db.insert(rules).values({ stationId: station.id, scope: "global", ruleType: "artist_separation", params: { minMinutes: 10 }, hardness: "hard" });

    const loaded = (await getRulesForEdit(db, station.id))!;
    const tighter = [{ ...loaded.rules[0], params: { minMinutes: 180 } }];
    const p = await previewRules(station.id, tighter, 3);
    const total = (v: Record<string, number>) => Object.values(v).reduce((x, y) => x + y, 0);
    expect(p.saved.hours).toHaveLength(3);
    expect(total(p.draft.violations)).toBeGreaterThan(total(p.saved.violations));
    expect(await db.select().from(rules).where(eq(rules.stationId, station.id))).toHaveLength(1);
  });
});
