/**
 * How early may a legal ID air — and what does refusing to let it buy you?
 *
 * WHY THIS EXISTS
 * ---------------
 * §73.1201(a) wants the ID "as close to the hour as feasible, at a natural break". Early
 * and late are not symmetric: an ID at :58 is ambiguous about WHICH hour it identifies,
 * where the same distance late is merely late. So the instinct is to forbid early.
 *
 * Forbidding it is expensive, and this prices the cost. Fitting an hour is choosing where
 * to stop against a gap the width of one song; allowed both sides, you take the nearer
 * edge and the residual is bounded by HALF a song. Allowed only the late side, you take
 * whichever late edge presents itself and the worst case roughly doubles.
 *
 * The output is a curve: worst-case and p95 |drift| against the early tolerance. It turns
 * "how early is acceptable" from a matter of taste into a priced trade.
 *
 * WHAT IT IS NOT. This does not model the stream buffer. Encoder-to-listener latency is a
 * CONSTANT offset — it delays every item equally, so it shifts the whole log rather than
 * accumulating — and belongs at the adapter as a fixed correction, never inside a feedback
 * loop that would spend forever re-correcting a constant.
 *
 * READ-ONLY. Durations come from the Scheduler's Postgres; nothing is written.
 *
 *   set -a; . packages/schema/.env; set +a; node tools/drift-curve.mjs
 *   node tools/drift-curve.mjs --clock ES --hours 200000
 */
import postgres from "postgres";
import { SHAPES, IMAGING, FILLER_SLOTS } from "./m4-format.mjs";
import { buildReachable, fitHour, type FitUnit } from "../packages/engine/src/fit.js";

const argOf = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const CLOCK = argOf("clock") ?? "ES";
const HOURS = Number(argOf("hours") ?? 200_000);
/**
 * The pool supplying the MARGINAL unit — the thing added to close the last gap.
 *
 * This, not the clock, sets where the optimum sits. The clock decides how far the hour
 * has to travel; the marginal pool decides the size of the step it travels in, and the
 * residual after a best fit is bounded by that step. Every clock on this station lands on
 * the same tolerance because every clock fits with F.
 */
const MARGINAL = (argOf("marginal") ?? "F").split(",");

/**
 * Early tolerances to price, in seconds. 0 = early forbidden outright.
 * Override with --tol 60,70,80,90 to resolve a region of the curve more finely.
 */
const TOLERANCES = (argOf("tol") ?? "0,5,10,15,20,30,45,60,90,120").split(",").map(Number);

/** Late is bounded far more loosely — it is the tolerable direction. */
const MAX_LATE_S = 300;

const sql = postgres(process.env.DATABASE_URL, { max: 1 });
const rows = await sql`
  select c.name as cat, coalesce(s.effective_duration_ms, s.duration_ms) as ms
  from categories c
  join song_categories sc on sc.category_id = c.id
  join songs s on s.id = sc.song_id and s.enabled
  where coalesce(s.effective_duration_ms, s.duration_ms) > 0`;
await sql.end();

const pool: Record<string, number[]> = {};
for (const r of rows) (pool[r.cat] ??= []).push(Number(r.ms));

// Deterministic PRNG so a rerun reproduces the curve exactly. --seed draws an INDEPENDENT
// sample: the point of a second sample is to see how much of a difference between two rows
// is signal and how much is Monte Carlo noise, and a fixed seed can never show that.
let seed = Number(argOf("seed") ?? 20260804);
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const draw = (c: string) => pool[c][Math.floor(rnd() * pool[c].length)];

const shape = SHAPES[CLOCK];
if (!shape) { console.error(`unknown clock "${CLOCK}"`); process.exit(1); }
const imaging = Object.entries(IMAGING[CLOCK] ?? {}).filter(([c]) => pool[c]?.length);

/** Categories this clock may give up, cheapest first — mirrors TRIM_PRIORITY. */
const TRIMMABLE = ["G1990", "G2000", "G2010", "R3", "Discovery"].filter((c) => shape[c]);
const FILLER_CAP = FILLER_SLOTS[CLOCK] ?? 5;

/**
 * One hour under the control law: absorb the prior drift into this hour's budget, build
 * the authored positions, then fit with filler and trims. `earlyTolMs` bounds how far
 * BEFORE :00 the resulting TOH is permitted to land.
 */
/**
 * The closing pool: every duration the fit is allowed to reach for, across ALL categories
 * the PD has nominated. Built once — reachable totals depend on the durations and the slot
 * count, not on the hour.
 */
const closers: FitUnit[] = MARGINAL.flatMap((cat) =>
  (pool[cat] ?? []).map((ms, i) => ({ id: `${cat}-${i}`, durationMs: ms, categoryId: cat }))
);
if (!closers.length) { console.error(`no enabled songs in closer pool [${MARGINAL.join(", ")}]`); process.exit(1); }
/**
 * How many candidate songs the fit actually gets to choose between, per slot.
 *
 * The whole pool is NOT available: rotation rules (rest, separation, artist windows) mean
 * the generator picks from a shortlist of well-rested candidates — config.searchDepth is 5
 * today. Precision is bought with breadth, so this is the knob that decides how close the
 * hour can land, and modelling the full pool overstates it badly.
 */
const BREADTH = Number(argOf("breadth") ?? 0) || closers.length;
const wholePool = BREADTH >= closers.length;
const REACHABLE_FULL = wholePool ? buildReachable(closers, FILLER_CAP) : null;
const shortlist = () => {
  if (REACHABLE_FULL) return REACHABLE_FULL;
  const pickN: FitUnit[] = [];
  for (let i = 0; i < BREADTH; i++) pickN.push(closers[Math.floor(rnd() * closers.length)]);
  return buildReachable(pickN, FILLER_CAP);
};

/**
 * One hour under the control law: absorb the prior drift into this hour's budget, draw the
 * authored positions, then hand the fit to the ENGINE.
 *
 * Calling engine code rather than reimplementing it is the whole point. This tool shipped
 * its own greedy fit and got two bugs for it, both of which produced confident, plausible,
 * wrong curves. A simulation with its own copy of the logic validates a model of the
 * product, not the product.
 */
function hour(driftMs: number, earlyTolMs: number): number {
  let len = 0;
  for (const [cat, n] of Object.entries(shape)) for (let i = 0; i < (n as number); i++) len += draw(cat);
  for (const [cat, n] of imaging) for (let i = 0; i < (n as number); i++) len += draw(cat);

  const removable: FitUnit[] = TRIMMABLE.map((c, i) => ({ id: `trim-${i}`, durationMs: draw(c), categoryId: c }));

  return fitHour({
    currentMs: len,
    targetMs: 3_600_000 - driftMs,
    maxEarlyMs: earlyTolMs,
    removable,
    reachable: shortlist(),
  }).driftMs;
}

function run(earlyTolS: number, streamSeed: number) {
  // COMMON RANDOM NUMBERS: every tolerance sees the same draw sequence, so differences
  // between rows are the tolerance and not the sample. Without this the curve is noisy
  // enough at 100k hours to invert adjacent rows.
  seed = streamSeed;
  const earlyTolMs = earlyTolS * 1000;
  let d = 0;
  const abs: number[] = [], signed: number[] = [];
  const NOCARRY = process.argv.includes("--nocarry");
  for (let i = 0; i < HOURS; i++) {
    d = hour(NOCARRY ? 0 : d, earlyTolMs);
    d = Math.max(-earlyTolMs, Math.min(MAX_LATE_S * 1000, d));
    abs.push(Math.abs(d));
    signed.push(d);
  }
  abs.sort((a, b) => a - b);
  const early = signed.filter((x) => x < 0).length;
  return {
    p50: abs[(HOURS * 0.5) | 0] / 1000,
    p95: abs[(HOURS * 0.95) | 0] / 1000,
    max: abs[HOURS - 1] / 1000,
    earlyShare: early / HOURS,
    meanLate: signed.filter((x) => x > 0).reduce((a, b) => a + b, 0) / Math.max(1, signed.filter((x) => x > 0).length) / 1000,
  };
}

console.log(`## TOH drift vs early tolerance — clock ${CLOCK}, closers [${MARGINAL.join(" + ")}], ${HOURS.toLocaleString()} hours\n`);
console.log("| early tolerance | median \\|drift\\| | p95 | worst case | hours landing early | mean late |");
console.log("|---|---|---|---|---|---|");
const curve: any[] = [];
for (const t of TOLERANCES) {
  const r = run(t, Number(argOf("seed") ?? 20260804));
  curve.push({ t, ...r });
  console.log(
    `| ${t === 0 ? "**0 (forbidden)**" : `${t}s`} | ${r.p50.toFixed(0)}s | ${r.p95.toFixed(0)}s | ` +
      `**${r.max.toFixed(0)}s** | ${(r.earlyShare * 100).toFixed(0)}% | ${r.meanLate.toFixed(0)}s |`
  );
}

// There is no knee — the curve is smooth, and the three metrics do not agree on an
// optimum. Median is minimised at a modest tolerance and gets WORSE beyond it (more room
// to sit early means more hours sitting early), while p95 and worst case keep improving.
// So report all three minima rather than inventing a single answer.
const best = (k: string) => curve.reduce((a, b) => (b[k] < a[k] ? b : a));
const base = curve[0];
const bMed = best("p50"), bP95 = best("p95"), bMax = best("max");
console.log(
  `\nForbidding early entirely costs **${base.max.toFixed(0)}s worst case, ${base.p95.toFixed(0)}s p95**.\n` +
    `  best median      ${bMed.t}s tolerance → ${bMed.p50.toFixed(0)}s\n` +
    `  best p95         ${bP95.t}s tolerance → ${bP95.p95.toFixed(0)}s\n` +
    `  best worst case  ${bMax.t}s tolerance → ${bMax.max.toFixed(0)}s`
);
console.log(
  `\nNo knee: the curve is smooth and the metrics disagree. Median worsens past its optimum` +
    ` because a wider tolerance means more hours choosing to sit early, while the tail keeps` +
    ` improving. Pick the row by which metric the station is defending — typical hour (median)` +
    ` or the compliance argument (worst case). Set DEFAULT_CONFIG.maxEarlyDriftMs from that row.`
);
