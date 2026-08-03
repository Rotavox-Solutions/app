/**
 * Generate a log against LIVE data and report what it would look like — without
 * persisting anything.
 *
 * WHY THIS EXISTS
 * ---------------
 * On 2026-08-03 the conditional-filler work shipped with three bugs that the engine's
 * unit tests could not see, because every synthetic song in those fixtures is exactly
 * 200 000 ms. Uniform durations make hour arithmetic exact, which is precisely the
 * condition under which an estimator's sampling error, a sacrifice overshoot, and a
 * conditional buffer all behave perfectly.
 *
 * The first log generated from the real library ran hours from 51.3 to 62.4 minutes.
 * This tool found all three in about a minute.
 *
 * Fixtures prove the logic is internally consistent. Only real durations prove the hour
 * lands. Run this before any change to clock shapes, depths, filler or the generator
 * reaches an approved log.
 *
 * READ-ONLY. It loads generation inputs and runs the engine in memory; nothing is
 * written, no log row is created, and an existing horizon is never touched.
 *
 *   npx tsx tools/dry-run-log.mts
 *   npx tsx tools/dry-run-log.mts --hours 48 --start 2026-08-04T00:00:00Z
 *   npx tsx tools/dry-run-log.mts --min 58 --max 62      # tighten the gate
 *
 * Exits non-zero when an hour falls outside tolerance, so it can gate a deploy rather
 * than merely inform one.
 */
import { loadGenerationInputs } from "../apps/web/src/lib/generation.js";
import { generateLog } from "../packages/engine/src/index.js";

const argOf = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

const STATION = process.env.SCHEDULER_STATION_ID ?? "6a42a599-acfc-404f-a524-9fb9b65d36f3";
const HOURS = Number(argOf("hours") ?? 24);
// Default to the next whole hour, matching what generation would actually pick.
const START = argOf("start")
  ? new Date(argOf("start")!)
  : new Date(Math.ceil(Date.now() / 3_600_000) * 3_600_000);
const MIN_OK = Number(argOf("min") ?? 57);
const MAX_OK = Number(argOf("max") ?? 63);

function main(): void {
  void run();
}

async function run(): Promise<void> {
  const end = new Date(START.getTime() + HOURS * 3_600_000);
  const { input, cueFidelity, songsWithoutCue } = await loadGenerationInputs(STATION, START, end);
  input.seed = `dry-run-${START.toISOString()}`;
  const res = generateLog(input);

  const posById = new Map(input.clocks.flatMap((c) => c.positions.map((p) => [p.id, p] as const)));
  const clockOfPos = new Map<string, string>();
  for (const c of input.clocks) for (const p of c.positions) clockOfPos.set(p.id, c.name);
  const songById = new Map(input.songs.map((s) => [s.id, s] as const));

  interface Row { clock: string; items: number; filler: number; buffer: number; ms: number; unfilled: number }
  const hours = new Map<string, Row>();

  for (const it of res.items) {
    const key = it.projectedAirAt.toISOString().slice(0, 13);
    const row = hours.get(key) ?? { clock: "?", items: 0, filler: 0, buffer: 0, ms: 0, unfilled: 0 };
    row.items++;
    row.ms += (it.songId ? songById.get(it.songId)?.durationMs : 0) ?? 0;
    if (!it.songId) row.unfilled++;
    const pos = it.clockPositionId ? posById.get(it.clockPositionId) : undefined;
    if (pos) {
      row.clock = clockOfPos.get(pos.id) ?? row.clock;
      const fp = pos.constraints?.fillerPriority;
      if (fp != null) { row.filler++; if (fp === 1) row.buffer++; }
    }
    hours.set(key, row);
  }

  const fmt = (n: number, w: number) => String(n).padStart(w);
  console.log(
    `station ${STATION}\n` +
      `horizon ${START.toISOString()} + ${HOURS}h\n` +
      `cue fidelity ${(cueFidelity * 100).toFixed(1)}%` +
      (songsWithoutCue ? `  (${songsWithoutCue} song(s) without a segue point)` : "") +
      `\nfiller activated ${res.stats.fillerActivated} · sacrificed ${res.stats.sacrificed} · ` +
      `trimmed ${res.stats.trimmed} · unfillable ${res.stats.unfillable}\n`
  );

  console.log("hour (UTC)   clock  items    F  buf  unfilled   minutes");
  const mins: number[] = [];
  const bad: string[] = [];
  for (const [key, r] of [...hours].sort()) {
    const m = r.ms / 60000;
    mins.push(m);
    const off = m < MIN_OK || m > MAX_OK;
    if (off) bad.push(`${key} ${m.toFixed(1)}min`);
    console.log(
      `${key}  ${r.clock.padEnd(5)} ${fmt(r.items, 5)} ${fmt(r.filler, 4)} ${fmt(r.buffer, 4)} ` +
        `${fmt(r.unfilled, 9)}   ${m.toFixed(2).padStart(6)}${off ? "  <-- OUT OF TOLERANCE" : ""}`
    );
  }

  if (mins.length === 0) {
    console.error("\nNo hours generated — check the grid covers this horizon.");
    process.exit(1);
  }

  const sorted = [...mins].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  console.log(
    `\n${mins.length} hours | min ${Math.min(...mins).toFixed(1)} | ` +
      `median ${median.toFixed(1)} | max ${Math.max(...mins).toFixed(1)} | ` +
      `tolerance ${MIN_OK}-${MAX_OK} min`
  );

  // Warnings are the generator telling you a clock is under-authored or an hour could
  // not be closed. They are the early signal that shapes and depths have drifted apart.
  const shown = res.warnings.slice(0, 12);
  if (shown.length) {
    console.log(`\nwarnings (${res.warnings.length}):`);
    for (const w of shown) console.log(`  ${w}`);
    if (res.warnings.length > shown.length) {
      console.log(`  ... and ${res.warnings.length - shown.length} more`);
    }
  }

  if (bad.length) {
    console.error(`\nFAIL — ${bad.length} hour(s) outside ${MIN_OK}-${MAX_OK} min: ${bad.join(", ")}`);
    process.exit(1);
  }
  console.log("\nOK — every hour within tolerance.");
  process.exit(0);
}

main();
