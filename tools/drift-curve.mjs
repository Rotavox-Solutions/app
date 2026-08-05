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
import { SHAPES, IMAGING } from "./m4-format.mjs";

const argOf = (n) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const CLOCK = argOf("clock") ?? "ES";
const HOURS = Number(argOf("hours") ?? 200_000);

/** Early tolerances to price, in seconds. 0 = early forbidden outright. */
const TOLERANCES = [0, 5, 10, 15, 20, 30, 45, 60, 90, 120];

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

// Deterministic PRNG so a rerun reproduces the curve exactly.
let seed = 20260804;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const draw = (c) => pool[c][Math.floor(rnd() * pool[c].length)];

const shape = SHAPES[CLOCK];
if (!shape) { console.error(`unknown clock "${CLOCK}"`); process.exit(1); }
const imaging = Object.entries(IMAGING[CLOCK] ?? {}).filter(([c]) => pool[c]?.length);

/** Categories this clock may give up, cheapest first — mirrors TRIM_PRIORITY. */
const TRIMMABLE = ["G1990", "G2000", "G2010", "R3", "Discovery"].filter((c) => shape[c]);

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
  // Landing at `len` leaves drift (len - target). Permitted iff not earlier than tolerance.
  const permitted = (l) => l - target >= -earlyTolMs;
  const cost = (l) => (permitted(l) ? Math.abs(l - target) : Infinity);

  // ADD: filler while it strictly improves and stays permitted.
  for (let i = 0; i < 6; i++) {
    const d = draw("F");
    if (cost(len + d) >= cost(len)) break;
    len += d;
  }
  // If still not permitted (we are too early and filler could not reach), keep adding
  // even though each step overshoots — an early TOH outside tolerance is not an option.
  for (let i = 0; i < 6 && !permitted(len); i++) len += draw("F");

  // TRIM: give up trimmable positions while it strictly improves.
  for (const c of TRIMMABLE) {
    const d = draw(c);
    if (cost(len - d) < cost(len)) len -= d;
  }
  return len - target;
}

function run(earlyTolS) {
  const earlyTolMs = earlyTolS * 1000;
  let d = 0;
  const abs = [], signed = [];
  for (let i = 0; i < HOURS; i++) {
    d = hour(d, earlyTolMs);
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

console.log(`## TOH drift vs early tolerance — clock ${CLOCK}, ${HOURS.toLocaleString()} hours\n`);
console.log("| early tolerance | median \\|drift\\| | p95 | worst case | hours landing early | mean late |");
console.log("|---|---|---|---|---|---|");
const curve = [];
for (const t of TOLERANCES) {
  const r = run(t);
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
