// "Try this clock": generate the next few hours with one clock, in memory, against live
// songs, rules and play history, for the saved clock and the editor's draft side by side.
// What tools/dry-run-log.mts does for engineers, for one clock and from the editor.
// READ-ONLY: nothing is written, and no log or horizon is touched.
import { generateLog, type EngineClock, type GenerateLogInput } from "@rotavox/engine";
import { positionsFromDraft, type ClockDraft } from "@rotavox/schema";
import { loadGenerationInputs } from "./generation";
import { HOUR_MS } from "./constants";

/** Hours outside this band are flagged, as tools/dry-run-log.mts gates on. */
export const PREVIEW_TOLERANCE_MINUTES = { min: 57, max: 63 };
export const PREVIEW_MAX_HOURS = 24;

export interface PreviewItem {
  /** The position's number in the clock it came from, or null for a stray item. */
  position: number | null;
  elementType: string;
  category: string | null;
  artist: string | null;
  title: string | null;
  durationMs: number;
  filler: boolean;
  violations: number;
}

export interface PreviewHour {
  hour: string;
  minutes: number;
  items: number;
  filler: number;
  unfilled: number;
  running: PreviewItem[];
}

export interface PreviewRun {
  hours: PreviewHour[];
  min: number;
  median: number;
  max: number;
  outOfTolerance: number;
  warnings: string[];
  stats: { fillerActivated: number; sacrificed: number; trimmed: number; unfillable: number; anchorFallbacks: number };
}

export interface ClockPreview {
  start: string;
  hours: number;
  /** Share of the library with a known segue point: below 1, lengths are approximate. */
  cueFidelity: number;
  saved: PreviewRun;
  draft: PreviewRun;
}

/** Every grid cell plays this one clock, across the whole rotation cycle. */
function onlyThisClock(input: GenerateLogInput, clockId: string): GenerateLogInput["grid"] {
  const weeks = Math.max(1, input.cycleWeeks ?? 1);
  const grid: GenerateLogInput["grid"] = [];
  for (let weekInCycle = 0; weekInCycle < weeks; weekInCycle++) {
    for (let dayOfWeek = 0; dayOfWeek < 7; dayOfWeek++) {
      for (let hour = 0; hour < 24; hour++) grid.push({ weekInCycle, dayOfWeek, hour, clockId });
    }
  }
  return grid;
}

function run(input: GenerateLogInput, clock: EngineClock): PreviewRun {
  const res = generateLog({ ...input, clocks: input.clocks.map((c) => (c.id === clock.id ? clock : c)) });
  const songById = new Map(input.songs.map((s) => [s.id, s]));
  const catName = new Map(input.categories.map((c) => [c.id, c.name]));
  const posById = new Map(clock.positions.map((p) => [p.id, p]));

  const byHour = new Map<string, PreviewHour>();
  for (const it of res.items) {
    // Bucket on the nominal hour, never the projected air time (see GeneratedItem.nominalHour).
    const key = it.nominalHour.toISOString();
    const hour = byHour.get(key) ?? { hour: key, minutes: 0, items: 0, filler: 0, unfilled: 0, running: [] };
    const song = it.songId ? songById.get(it.songId) : undefined;
    const pos = it.clockPositionId ? posById.get(it.clockPositionId) : undefined;
    const durationMs =
      song?.durationMs ?? (pos?.positionType === "fixed_event" ? (pos.constraints?.fixedDurationSeconds ?? 0) * 1000 : 0);
    const filler = pos?.constraints?.fillerPriority != null;
    hour.items++;
    hour.minutes += durationMs / 60_000;
    if (filler) hour.filler++;
    if (!it.songId && pos?.positionType !== "fixed_event") hour.unfilled++;
    hour.running.push({
      position: pos?.sortOrder ?? null,
      elementType: it.elementType,
      category: pos?.categoryId ? catName.get(pos.categoryId) ?? null : null,
      artist: song?.artist ?? null,
      title: song?.title ?? null,
      durationMs,
      filler,
      violations: it.violations.length,
    });
    byHour.set(key, hour);
  }
  const hours = [...byHour.values()].sort((a, b) => a.hour.localeCompare(b.hour));
  const mins = hours.map((h) => h.minutes).sort((a, b) => a - b);
  return {
    hours,
    min: mins[0] ?? 0,
    median: mins[Math.floor(mins.length / 2)] ?? 0,
    max: mins[mins.length - 1] ?? 0,
    outOfTolerance: mins.filter((m) => m < PREVIEW_TOLERANCE_MINUTES.min || m > PREVIEW_TOLERANCE_MINUTES.max).length,
    warnings: res.warnings,
    stats: {
      fillerActivated: res.stats.fillerActivated,
      sacrificed: res.stats.sacrificed,
      trimmed: res.stats.trimmed,
      unfillable: res.stats.unfillable,
      anchorFallbacks: res.stats.anchorFallbacks,
    },
  };
}

export async function previewClock(
  stationId: string,
  clockId: string,
  draft: ClockDraft,
  hours: number,
  now: Date = new Date()
): Promise<ClockPreview | null> {
  const start = new Date(Math.ceil(now.getTime() / HOUR_MS) * HOUR_MS);
  const end = new Date(start.getTime() + hours * HOUR_MS);
  const { input, cueFidelity } = await loadGenerationInputs(stationId, start, end);
  const saved = input.clocks.find((c) => c.id === clockId);
  if (!saved) return null;
  const base: GenerateLogInput = { ...input, grid: onlyThisClock(input, clockId), seed: `preview-${clockId}-${start.toISOString()}` };
  const draftClock: EngineClock = {
    id: clockId,
    name: draft.name,
    lengthMinutes: draft.lengthMinutes,
    positions: positionsFromDraft(draft) as EngineClock["positions"],
  };
  return {
    start: start.toISOString(),
    hours,
    cueFidelity,
    saved: run(base, saved),
    draft: run(base, draftClock),
  };
}
