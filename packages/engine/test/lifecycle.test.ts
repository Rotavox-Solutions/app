import { describe, expect, it } from "vitest";
import { basePool } from "../src/index.js";
import { song } from "./fixtures.js";

describe("lifecycle state in the base pool", () => {
  it("schedules only active songs — a resting song keeps its pool but never airs", () => {
    const pool = basePool(
      [
        song({ rdjSongId: 1, categoryIds: ["N"] }),
        song({ rdjSongId: 2, categoryIds: ["N"], lifecycleState: "active" }),
        song({ rdjSongId: 3, categoryIds: ["N"], lifecycleState: "resting" }),
        song({ rdjSongId: 4, categoryIds: ["N"], lifecycleState: "benched" }),
      ],
      new Set(["N"]),
      [0]
    );
    expect(pool.map((s) => s.rdjSongId)).toEqual([1, 2]);
  });
});
