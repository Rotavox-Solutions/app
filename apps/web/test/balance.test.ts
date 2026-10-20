import { describe, expect, it } from "vitest";
import { classifyBalance, computeBalance, requiredDepth, type BalanceInput } from "../src/lib/balance";

const cat = (id: string, parentId: string | null = null, target: number | null = null) => ({
  id,
  name: id,
  kind: "music",
  parentId,
  defaultTargetTurnoverHours: target,
});

function input(over: Partial<BalanceInput>): BalanceInput {
  return { categories: [], memberships: [], positions: [], grid: [], cycleWeeks: 1, recentSpinsBySong: new Map(), ...over };
}

describe("computeBalance", () => {
  it("states turnover as 168 * enabled depth / weekly slots", () => {
    // One clock, two A1 positions, airing every hour of the week = 336 slots.
    const grid = Array.from({ length: 168 }, () => ({ clockId: "k" }));
    const [a1] = computeBalance(
      input({
        categories: [cat("A1", null, 6)],
        memberships: Array.from({ length: 7 }, (_, i) => ({ songId: `s${i}`, categoryId: "A1", enabled: true })),
        positions: [
          { clockId: "k", categoryId: "A1" },
          { clockId: "k", categoryId: "A1" },
        ],
        grid,
      })
    );
    expect(a1.weeklySlots).toBe(336);
    expect(a1.projectedTurnoverHours).toBeCloseTo(3.5);
    expect(a1.status).toBe("hot");
    expect(requiredDepth(a1)).toBe(12);
  });

  it("counts only enabled songs as real depth", () => {
    const [c] = computeBalance(
      input({
        categories: [cat("C")],
        memberships: [
          { songId: "a", categoryId: "C", enabled: true },
          { songId: "b", categoryId: "C", enabled: false },
        ],
      })
    );
    expect(c.depth).toBe(2);
    expect(c.enabledDepth).toBe(1);
  });

  it("averages slots over the rotation cycle", () => {
    // Clock k airs once in week 0 and not in week 1 of a 2-week cycle.
    const [g] = computeBalance(
      input({
        categories: [cat("G")],
        positions: [{ clockId: "k", categoryId: "G" }],
        grid: [{ clockId: "k" }],
        cycleWeeks: 2,
      })
    );
    expect(g.weeklySlots).toBe(0.5);
  });

  it("draws a parent's depth from its sub-pools without double-counting", () => {
    const rows = computeBalance(
      input({
        categories: [cat("Gold"), cat("G1990", "Gold"), cat("G2000", "Gold")],
        memberships: [
          { songId: "x", categoryId: "G1990", enabled: true },
          { songId: "x", categoryId: "G2000", enabled: true },
          { songId: "y", categoryId: "G2000", enabled: true },
        ],
        recentSpinsBySong: new Map([["x", 3]]),
      })
    );
    const gold = rows.find((r) => r.id === "Gold")!;
    expect(gold.hasChildren).toBe(true);
    expect(gold.enabledDepth).toBe(2);
    expect(gold.recentSpins).toBe(3);
  });

  it("flags a called category with no enabled songs as empty", () => {
    const [n] = computeBalance(
      input({
        categories: [cat("N", null, 15)],
        memberships: [{ songId: "a", categoryId: "N", enabled: false }],
        positions: [{ clockId: "k", categoryId: "N" }],
        grid: [{ clockId: "k" }],
      })
    );
    expect(n.status).toBe("empty");
    expect(n.projectedTurnoverHours).toBeNull();
  });
});

describe("classifyBalance", () => {
  it("bands projected turnover against target", () => {
    expect(classifyBalance(10, 5, 7, 10)).toBe("hot");
    expect(classifyBalance(10, 5, 10, 10)).toBe("on_target");
    expect(classifyBalance(10, 5, 13, 10)).toBe("cold");
    expect(classifyBalance(10, 5, 13, null)).toBe("no_target");
    expect(classifyBalance(0, 5, null, 10)).toBe("uncalled");
  });
});

describe("fallback coverage", () => {
  it("treats an empty pool as covered only when every calling position has a fallback", () => {
    const base = {
      categories: [cat("TOH ES", null, 24)],
      grid: [{ clockId: "k" }, { clockId: "j" }],
    };
    const [covered] = computeBalance(
      input({ ...base, positions: [{ clockId: "k", categoryId: "TOH ES", fallbackCategoryId: "TOH IDs" }] })
    );
    expect(covered.status).toBe("covered");

    const [partly] = computeBalance(
      input({
        ...base,
        positions: [
          { clockId: "k", categoryId: "TOH ES", fallbackCategoryId: "TOH IDs" },
          { clockId: "j", categoryId: "TOH ES" },
        ],
      })
    );
    expect(partly.status).toBe("empty");
  });
});

describe("filler positions", () => {
  it("keeps conditional filler out of designed demand", () => {
    const [f] = computeBalance(
      input({
        categories: [cat("F")],
        memberships: [{ songId: "a", categoryId: "F", enabled: true }],
        positions: [{ clockId: "k", categoryId: "F", fillerPriority: 1 }],
        grid: [{ clockId: "k" }],
      })
    );
    expect(f).toMatchObject({ weeklySlots: 0, weeklyFillerSlots: 1, status: "filler" });
  });
});

describe("fallback pools", () => {
  it("marks a category that only backs up other positions as a fallback pool", () => {
    const rows = computeBalance(
      input({
        categories: [cat("TOH ES"), cat("TOH IDs")],
        memberships: [{ songId: "a", categoryId: "TOH IDs", enabled: true }],
        positions: [{ clockId: "k", categoryId: "TOH ES", fallbackCategoryId: "TOH IDs" }],
        grid: [{ clockId: "k" }],
      })
    );
    expect(rows.find((r) => r.id === "TOH IDs")).toMatchObject({ weeklyFallbackSlots: 1, status: "fallback" });
  });
});
