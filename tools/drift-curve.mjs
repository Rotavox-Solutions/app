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

const argOf = (n) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };
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
const MARGINAL = argOf("marginal") ?? "F";

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

const pool = {};
for (const r of rows) (pool[r.cat] ??= []).push(Number(r.ms));

// Deterministic PRNG so a rerun reproduces the curve exactly. --seed draws an INDEPENDENT
// sample: the point of a second sample is to see how much of a difference between two rows
// is signal and how much is Monte Carlo noise, and a fixed seed can never show that.
let seed = Number(argOf("seed") ?? 20260804);
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const draw = (c) => pool[c][Math.floor(rnd() * pool[c].length)];

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
function hour(driftMs, earlyTolMs) {
  let len = 0;
  for (const [cat, n] of Object.entries(shape)) for (let i = 0; i < n; i++) len += draw(cat);
  for (const [cat, n] of imaging) for (let i = 0; i < n; i++) len += draw(cat);

  const target = 3_600_000 - driftMs;
  const earliest = target - earlyTolMs;

  /**
   * LEXICOGRAPHIC cost: get inside the early bound first, then get close to :00.
   *
   * The obvious formulation -- Infinity for an impermissible landing -- is a trap, and it
   * cost this tool its first set of results. An hour BEGINS impermissible (ES is authored
   * 265s short of target), so a greedy loop comparing Infinity >= Infinity breaks on its
   * first iteration and never adds anything intelligently. What remained was a blind loop
   * that stopped the instant it crossed the bound, pinning every landing near
   * `target - tolerance`. The curve then measured the tolerance against itself, and
   * reported the same optimum for every clock and every marginal pool -- which is exactly
   * the impossible invariance that exposed it.
   *
   * Violation must therefore be finite and orderable, so "less early than before" reads as
   * an improvement even while still outside the bound.
   */
  const cost = (l) => Math.max(0, earliest - l) * 1e6 + Math.abs(l - target);

  // TRIM first: giving up a position changes the gap the filler then has to close.
  for (const c of TRIMMABLE) {
    const d = draw(c);
    if (cost(len - d) < cost(len)) len -= d;
  }

  // ADD: choose WHICH filler by how well it closes the gap, scanning the pool rather
  // than drawing at random.
  //
  // This is not duration-aware song selection -- PERFECT-HOUR.md §3 rejects that for
  // programmed positions and permits it here explicitly, because a filler slot exists to
  // fill time and duration is therefore the job. Modelling a RANDOM filler draw was a
  // real error: it understates the fit, and it makes the result path-dependent, which
  // showed up as p95 rising with tolerance -- impossible, since a wider tolerance only
  // ever ADDS permitted landings and can never make the best one worse.
  for (let i = 0; i < FILLER_CAP; i++) {
    let best = null;
    let bestCost = cost(len);
    for (const d of pool[MARGINAL]) {
      const c2 = cost(len + d);
      if (c2 < bestCost) { bestCost = c2; best = d; }
    }
    if (best === null) break;
    len += best;
  }
  return len - target;
}

function run(earlyTolS, streamSeed) {
  // COMMON RANDOM NUMBERS: every tolerance sees the same draw sequence, so differences
  // between rows are the tolerance and not the sample. Without this the curve is noisy
  // enough at 100k hours to invert adjacent rows.
  seed = streamSeed;
  const earlyTolMs = earlyTolS * 1000;
  let d = 0;
  const abs = [], signed = [];
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

console.log(`## TOH drift vs early tolerance — clock ${CLOCK}, marginal ${MARGINAL}, ${HOURS.toLocaleString()} hours\n`);
console.log("| early tolerance | median \\|drift\\| | p95 | worst case | hours landing early | mean late |");
console.log("|---|---|---|---|---|---|");
const curve = [];
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
const best = (k) => curve.reduce((a, b) => (b[k] < a[k] ? b : a));
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
