import { describe, expect, it } from "vitest";
import { subcatForPlacement, type PendingProjection } from "@rotavox/schema";
import { planProjection } from "../src/projection.js";
import { validateShape } from "../src/changeset.js";

const cats = [
  { id: "a1", name: "A1", rdjSubcategoryIds: [5] },
  { id: "n", name: "N", rdjSubcategoryIds: [24] },
  { id: "h1", name: "H1", rdjSubcategoryIds: [2, 44] },
];
const lifecycle = {
  31: { state: "benched" as const },
  32: { state: "resting" as const },
  33: { state: "resting" as const, origin: "N" },
  34: { state: "retired" as const },
  35: { state: "benched" as const, default: true },
};

describe("subcatForPlacement", () => {
  it("maps pools to their first subcategory, and leaves a song already in one alone", () => {
    expect(subcatForPlacement({ state: "active", categoryId: "a1" }, 39, cats, lifecycle)).toBe(5);
    expect(subcatForPlacement({ state: "active", categoryId: "h1" }, 44, cats, lifecycle)).toBe(44);
    expect(subcatForPlacement({ state: "active", categoryId: "h1" }, 5, cats, lifecycle)).toBe(2);
  });

  it("rests into the pool's own rest subcategory, else the generic one", () => {
    expect(subcatForPlacement({ state: "resting", categoryId: "n" }, 24, cats, lifecycle)).toBe(33);
    expect(subcatForPlacement({ state: "resting", categoryId: "n" }, 32, cats, lifecycle)).toBe(33);
    expect(subcatForPlacement({ state: "resting", categoryId: "a1" }, 5, cats, lifecycle)).toBe(32);
    expect(subcatForPlacement({ state: "resting", categoryId: "a1" }, 32, cats, lifecycle)).toBe(32);
  });

  it("benches to the default, but leaves a song already in an equivalent bench", () => {
    expect(subcatForPlacement({ state: "benched", categoryId: null }, 5, cats, lifecycle)).toBe(35);
    expect(subcatForPlacement({ state: "benched", categoryId: null }, 31, cats, lifecycle)).toBe(31);
    expect(subcatForPlacement({ state: "retired", categoryId: null }, 5, cats, lifecycle)).toBe(34);
  });

  it("refuses what RadioDJ cannot express", () => {
    const noDefault = { ...lifecycle, 35: { state: "benched" as const } };
    expect(() => subcatForPlacement({ state: "benched", categoryId: null }, 5, cats, noDefault)).toThrow(/default/);
    expect(() =>
      subcatForPlacement({ state: "active", categoryId: "x" }, 5, [...cats, { id: "x", name: "X", rdjSubcategoryIds: [] }], lifecycle)
    ).toThrow(/no RadioDJ subcategory/);
  });
});

function pending(items: PendingProjection["items"], subcats: [string, number | null][]): PendingProjection {
  return {
    id: "0b75f0a1-a121-4e61-aa03-b50e42480e25",
    status: "applied",
    intent: "October moves",
    revertsChangesetId: null,
    createdAt: new Date("2026-10-24T10:00:00Z"),
    appliedAt: new Date("2026-10-24T10:05:00Z"),
    projection: "pending",
    projectedAt: null,
    projectionError: null,
    items,
    mirrorSubcat: new Map(subcats),
  };
}

const item = (songId: string, rdjSongId: number, to: { state: "active" | "resting" | "benched" | "retired"; categoryId: string | null }, reason: string | null = null) => ({
  id: `i-${songId}`,
  songId,
  rdjSongId,
  artist: "Artist",
  title: "Title",
  from: { state: "active" as const, categoryId: null },
  to,
  reason,
  fromRdjSubcat: null,
  toRdjSubcat: null,
});

describe("planProjection", () => {
  it("builds a valid v1 changeset, skipping songs RadioDJ already agrees with", () => {
    const plan = planProjection(
      pending(
        [item("s1", 101, { state: "active", categoryId: "a1" }, "Fresh add"), item("s2", 102, { state: "benched", categoryId: null })],
        [["s1", 39], ["s2", 31]]
      ),
      "station",
      cats,
      lifecycle
    );
    expect(plan.errors).toEqual([]);
    expect(plan.changeset!.id).toBe("2026-10-24-rotavox-0b75f0a1");
    expect(plan.changeset!.moves).toEqual([
      { rdj_song_id: 101, artist: "Artist", title: "Title", from_subcat: 39, to_subcat: 5, reason: "Fresh add" },
    ]);
    expect(validateShape(plan.changeset)).toEqual([]);
  });

  it("uses the intent where an item has no reason, and reports songs it cannot write", () => {
    const plan = planProjection(
      pending(
        [item("s1", 101, { state: "active", categoryId: "n" }), item("s2", 102, { state: "active", categoryId: "a1" })],
        [["s1", 39], ["s2", null]]
      ),
      "station",
      cats,
      lifecycle
    );
    expect(plan.changeset!.moves![0].reason).toBe("October moves");
    expect(plan.errors).toHaveLength(1);
    expect(plan.errors[0]).toMatch(/rdj 102.*sync-library/);
  });

  it("restores an undo's exact subcategory, even where the placement has none of its own", () => {
    const undo = { ...item("s1", 101, { state: "active", categoryId: null }), toRdjSubcat: 39 };
    const plan = planProjection(pending([undo], [["s1", 5]]), "station", cats, lifecycle);
    expect(plan.errors).toEqual([]);
    expect(plan.changeset!.moves![0]).toMatchObject({ from_subcat: 5, to_subcat: 39 });
  });

  it("produces nothing when RadioDJ already matches", () => {
    const plan = planProjection(pending([item("s1", 101, { state: "active", categoryId: "a1" })], [["s1", 5]]), "station", cats, lifecycle);
    expect(plan).toEqual({ changeset: null, errors: [] });
  });
});
