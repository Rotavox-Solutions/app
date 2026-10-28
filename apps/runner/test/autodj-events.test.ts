import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { planUtcEvents, utcOffsetMinutes, type LocalEvent } from "@rotavox/schema";
import { planEventWrites, type EventRow } from "../src/autodj-plan.js";

const LA = "America/Los_Angeles";
const plan = JSON.parse(readFileSync(path.resolve(import.meta.dirname, "../rdj-rotation-plan.json"), "utf8")) as {
  localEvents: LocalEvent[];
};

describe("the fail-safe's offset", () => {
  it("follows Los Angeles across the end of daylight saving", () => {
    // DST ends 2026-11-01 at 02:00 PDT = 09:00 UTC.
    expect(utcOffsetMinutes(new Date("2026-11-01T08:59:00Z"), LA)).toBe(-420);
    expect(utcOffsetMinutes(new Date("2026-11-01T09:00:00Z"), LA)).toBe(-480);
    expect(utcOffsetMinutes(new Date("2026-07-01T12:00:00Z"), "UTC")).toBe(0);
    expect(utcOffsetMinutes(new Date("2026-07-01T12:00:00Z"), "Asia/Kolkata")).toBe(330);
  });
});

describe("the plan at a UTC offset", () => {
  it("moves an evening hour onto the next UTC day", () => {
    const [e] = planUtcEvents([{ hour: 20, rot: "X", days: [6] }], -480);
    expect(e).toEqual({ hour: 4, rot: "X", days: [0] }); // Saturday 20:00 PST = Sunday 04:00 UTC
  });

  it("covers every hour of the week exactly once, in winter as in summer", () => {
    for (const offset of [-420, -480]) {
      const seen = new Set<string>();
      for (const e of planUtcEvents(plan.localEvents, offset)) for (const d of e.days) seen.add(`${d}:${e.hour}`);
      expect(seen.size).toBe(168);
    }
  });

  it("refuses a half-hour zone, which hourly events can't follow", () => {
    expect(() => planUtcEvents(plan.localEvents, 330)).toThrow(/whole number/);
  });
});

describe("writing the events", () => {
  const rotations = new Map([...new Set(plan.localEvents.map((e) => e.rot))].map((r, i) => [r, i + 1]));
  /** RadioDJ's rows as the projection would leave them at this offset. */
  const rowsAt = (offset: number): EventRow[] => {
    const { writes } = planEventWrites(planUtcEvents(plan.localEvents, offset), rotations, []);
    return writes.map((w, i) => ({ ID: i + 1, name: w.name, time: w.time, day: w.day, data: w.data, enabled: 1 }));
  };

  it("changes nothing when the events already match", () => {
    const r = planEventWrites(planUtcEvents(plan.localEvents, -420), rotations, rowsAt(-420));
    expect(r).toEqual({ writes: [], disable: [], unchanged: plan.localEvents.length });
  });

  it("moves to winter time by rewriting its own events, adding none and leaving the PD's alone", () => {
    const pd: EventRow = {
      ID: 99,
      name: "Clear Playlist",
      time: "03:00:00",
      day: "&1",
      data: "Clear Playlist|",
      enabled: 1,
    };
    const before = [...rowsAt(-420), pd];
    const r = planEventWrites(planUtcEvents(plan.localEvents, -480), rotations, before);
    expect(r.writes.every((w) => w.id !== null)).toBe(true); // reused, never inserted
    expect(r.writes.some((w) => w.id === 99)).toBe(false);
    expect(r.disable).not.toContain(99);
    expect(r.writes.length + r.unchanged).toBe(plan.localEvents.length);
    expect(new Set(r.writes.map((w) => w.id)).size).toBe(r.writes.length);
    // Every old row is either rewritten or kept as it is, since the count stays 42.
    expect(r.disable).toEqual([]);
  });

  it("disables an event of its own that the plan no longer needs", () => {
    const stray: EventRow = {
      ID: 50,
      name: "BOLT XX 07:00 UTC",
      time: "07:00:00",
      day: "&3",
      data: "Load Rotation|1|BOLT XX",
      enabled: 1,
    };
    const r = planEventWrites(planUtcEvents(plan.localEvents, -420), rotations, [...rowsAt(-420), stray]);
    expect(r.disable).toEqual([50]);
  });

  it("refuses a plan naming a rotation RadioDJ doesn't have", () => {
    expect(() => planEventWrites([{ hour: 1, rot: "Nope", days: [1] }], rotations, [])).toThrow(/no rotation/);
  });
});
