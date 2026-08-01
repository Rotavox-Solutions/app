import { describe, expect, it } from "vitest";
import {
  validateShape,
  validateAgainstLive,
  invert,
  normalizeTag,
  summarize,
  type Changeset,
  type LiveSong,
} from "../src/changeset.js";

/**
 * A changeset is the only artifact that rewrites the live broadcast library, so what's
 * tested here is refusal: malformed files, stale preconditions, ambiguous intent. The
 * happy path is one test; everything else is a way this should decline to write.
 */

const BASE: Changeset = {
  changeset_version: 1,
  id: "2026-07-31-test",
  station_id: "6a42a599-acfc-404f-a524-9fb9b65d36f3",
  authored_at: "2026-07-31",
  intent: "Test changeset.",
  basis: { sheet_id: "2026-07-31-slice" },
  moves: [
    {
      rdj_song_id: 1662,
      artist: "Almost Monday",
      title: "No More Regrets",
      from_subcat: 23,
      to_subcat: 4,
      reason: "Testing depth in A1",
    },
  ],
};

const live = (over: Partial<LiveSong> = {}): Map<number, LiveSong> =>
  new Map([
    [
      1662,
      {
        rdjSongId: 1662,
        artist: "Almost Monday",
        title: "No More Regrets",
        subcatId: 23,
        enabled: true,
        ...over,
      },
    ],
  ]);

const SUBCATS = new Set([4, 23, 24, 36, 39]);

describe("validateShape", () => {
  it("accepts a well-formed changeset", () => {
    expect(validateShape(BASE)).toEqual([]);
  });

  // A v2 file must fail loudly against a v1 applier rather than having its
  // understood subset applied and the rest silently dropped.
  it("rejects unknown top-level keys instead of ignoring them", () => {
    const errors = validateShape({ ...BASE, effective_at: "2026-08-01" });
    expect(errors).toContainEqual(expect.stringContaining("effective_at"));
  });

  it("rejects a version it cannot interpret", () => {
    expect(validateShape({ ...BASE, changeset_version: 2 })).toContainEqual(
      expect.stringContaining("changeset_version must be 1")
    );
  });

  it("requires a basis sheet, so decisions stay tied to their evidence", () => {
    const { basis, ...withoutBasis } = BASE;
    expect(validateShape(withoutBasis)).toContainEqual(expect.stringContaining("basis.sheet_id"));
  });

  it("requires a per-row reason", () => {
    const errors = validateShape({
      ...BASE,
      moves: [{ ...BASE.moves![0], reason: "  " }],
    });
    expect(errors).toContainEqual(expect.stringContaining("reason is required"));
  });

  // Two operations on one song make the intent ambiguous and the inverse ill-defined.
  it("rejects the same song appearing twice, across arrays", () => {
    const errors = validateShape({
      ...BASE,
      set_enabled: [
        {
          rdj_song_id: 1662,
          artist: "Almost Monday",
          title: "No More Regrets",
          from_enabled: true,
          to_enabled: false,
          reason: "Also disabling",
        },
      ],
    });
    expect(errors).toContainEqual(expect.stringContaining("already appears in"));
  });

  it("rejects no-op operations", () => {
    expect(validateShape({ ...BASE, moves: [{ ...BASE.moves![0], to_subcat: 23 }] })).toContainEqual(
      expect.stringContaining("no-op")
    );
  });

  it("rejects an empty changeset", () => {
    expect(validateShape({ ...BASE, moves: [] })).toContainEqual(
      expect.stringContaining("no operations")
    );
  });
});

describe("validateAgainstLive", () => {
  it("passes when live matches the preconditions", () => {
    const { errors } = validateAgainstLive(BASE, live(), SUBCATS);
    expect(errors).toEqual([]);
  });

  it("fails when the song has moved since the sheet was cut", () => {
    const { errors } = validateAgainstLive(BASE, live({ subcatId: 39 }), SUBCATS);
    expect(errors[0]).toMatch(/is in subcategory 39, changeset expected 23/);
  });

  it("fails when the song no longer exists", () => {
    const { errors } = validateAgainstLive(BASE, new Map(), SUBCATS);
    expect(errors[0]).toMatch(/does not exist/);
  });

  it("fails when the target subcategory is unknown", () => {
    const cs = { ...BASE, moves: [{ ...BASE.moves![0], to_subcat: 999 }] };
    const { errors } = validateAgainstLive(cs, live(), SUBCATS);
    expect(errors[0]).toMatch(/target subcategory 999 does not exist/);
  });

  it("fails on tag mismatch by default, and warns under --allow-tag-drift", () => {
    const drifted = live({ title: "No More Regrets (Radio Edit)" });
    expect(validateAgainstLive(BASE, drifted, SUBCATS).errors).toHaveLength(1);

    const relaxed = validateAgainstLive(BASE, drifted, SUBCATS, { allowTagDrift: true });
    expect(relaxed.errors).toEqual([]);
    expect(relaxed.warnings).toHaveLength(1);
  });

  // RadioDJ's own data contains embedded tabs and doubled spaces — one live ZN title
  // carries a literal tab — so a sheet that renders cleanly must still match its source.
  it("tolerates whitespace and case differences in tags", () => {
    const messy = live({ title: "no more\tregrets ", artist: "  Almost   Monday" });
    expect(validateAgainstLive(BASE, messy, SUBCATS).errors).toEqual([]);
  });

  it("checks enabled preconditions too", () => {
    const cs: Changeset = {
      ...BASE,
      moves: [],
      set_enabled: [
        {
          rdj_song_id: 1662,
          artist: "Almost Monday",
          title: "No More Regrets",
          from_enabled: false,
          to_enabled: true,
          reason: "Re-enable",
        },
      ],
    };
    const { errors } = validateAgainstLive(cs, live({ enabled: true }), SUBCATS);
    expect(errors[0]).toMatch(/has enabled=true, changeset expected false/);
  });
});

describe("invert", () => {
  it("swaps from and to, so applying the inverse restores the prior state", () => {
    const inv = invert(BASE);
    expect(inv.moves![0].from_subcat).toBe(4);
    expect(inv.moves![0].to_subcat).toBe(23);
    expect(inv.id).toBe("2026-07-31-test-inverse");
  });

  it("round-trips: inverting twice returns the original operations", () => {
    const twice = invert(invert(BASE));
    expect(twice.moves![0].from_subcat).toBe(BASE.moves![0].from_subcat);
    expect(twice.moves![0].to_subcat).toBe(BASE.moves![0].to_subcat);
  });

  it("produces a changeset that is itself valid", () => {
    expect(validateShape(invert(BASE))).toEqual([]);
  });

  it("validates against the state the original would have produced", () => {
    const after = live({ subcatId: 4 });
    expect(validateAgainstLive(invert(BASE), after, SUBCATS).errors).toEqual([]);
  });
});

describe("normalizeTag", () => {
  it("collapses whitespace, trims, and folds case", () => {
    expect(normalizeTag("  Manifest\t (Original  Mix) ")).toBe("manifest (original mix)");
    expect(normalizeTag(null)).toBe("");
  });
});

describe("summarize", () => {
  it("reports net movement per subcategory", () => {
    const cs: Changeset = {
      ...BASE,
      moves: [
        { ...BASE.moves![0], rdj_song_id: 1, from_subcat: 36, to_subcat: 24 },
        { ...BASE.moves![0], rdj_song_id: 2, from_subcat: 36, to_subcat: 24 },
        { ...BASE.moves![0], rdj_song_id: 3, from_subcat: 39, to_subcat: 24 },
      ],
    };
    const byId = new Map(summarize(cs).map((s) => [s.subcatId, s]));
    expect(byId.get(24)).toMatchObject({ in: 3, out: 0 });
    expect(byId.get(36)).toMatchObject({ in: 0, out: 2 });
  });
});
