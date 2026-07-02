import type {
  EngineCategory,
  EngineClock,
  EnginePosition,
  EngineRule,
  EngineSong,
  GenerateLogInput,
  GridSlot,
  HistoryEntry,
} from "../src/index.js";

let nextId = 0;
export function uid(prefix: string): string {
  return `${prefix}-${String(++nextId).padStart(4, "0")}`;
}

export function song(overrides: Partial<EngineSong> & { rdjSongId: number }): EngineSong {
  return {
    id: `song-${overrides.rdjSongId}`,
    artist: `Artist ${overrides.rdjSongId}`,
    title: `Title ${overrides.rdjSongId}`,
    album: null,
    durationMs: 200_000,
    songType: 0,
    categoryIds: [],
    era: null,
    tempo: null,
    energy: null,
    mood: null,
    soundCodes: null,
    targetTurnoverHours: null,
    enabled: true,
    ...overrides,
  };
}

export function category(overrides: Partial<EngineCategory> & { id: string }): EngineCategory {
  return {
    name: overrides.id,
    kind: "music",
    parentId: null,
    defaultTargetTurnoverHours: null,
    ...overrides,
  };
}

export function position(overrides: Partial<EnginePosition> & { sortOrder: number }): EnginePosition {
  return {
    id: `pos-${overrides.sortOrder}`,
    positionType: "category",
    categoryId: null,
    targetOffsetSeconds: null,
    constraints: null,
    fixedRef: null,
    ...overrides,
  };
}

export function rule(overrides: Partial<EngineRule> & { id: string; ruleType: string }): EngineRule {
  return {
    scope: "global",
    scopeRef: null,
    params: null,
    hardness: "hard",
    weight: null,
    ...overrides,
  };
}

export function history(rdjSongId: number, artist: string, title: string, airedAt: Date): HistoryEntry {
  return { rdjSongId, artist, title, airedAt };
}

/** A minimal single-clock, single-category world. UTC timezone keeps hour math trivial. */
export function baseInput(overrides: Partial<GenerateLogInput> = {}): GenerateLogInput {
  const cat = category({ id: "cat-main" });
  const songs = Array.from({ length: 12 }, (_, i) =>
    song({ rdjSongId: i + 1, categoryIds: ["cat-main"] })
  );
  const clock: EngineClock = {
    id: "clock-1",
    name: "Test Hour",
    positions: [
      position({ sortOrder: 1, categoryId: "cat-main" }),
      position({ sortOrder: 2, categoryId: "cat-main" }),
      position({ sortOrder: 3, categoryId: "cat-main" }),
    ],
  };
  const grid: GridSlot[] = [];
  for (let d = 0; d < 7; d++) for (let h = 0; h < 24; h++) grid.push({ dayOfWeek: d, hour: h, clockId: "clock-1" });

  return {
    timezone: "UTC",
    horizonStart: new Date("2026-07-06T00:00:00.000Z"), // a Monday
    horizonEnd: new Date("2026-07-06T02:00:00.000Z"),
    seed: "fixture-seed",
    clocks: [clock],
    grid,
    categories: [cat],
    songs,
    rules: [rule({ id: "r-artist", ruleType: "artist_separation", params: { minMinutes: 45 } })],
    history: [],
    ...overrides,
  };
}
