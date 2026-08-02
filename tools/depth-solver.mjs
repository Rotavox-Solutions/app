// Solve category depth. With the schedule locked, depth is the only free variable and
// everything else is a consequence of it.
//
//   depth -> turnover = 168 * depth / slots_per_week
//         -> pacing   = 24 / turnover                (must sit in the format's band)
//         -> drift    = frac(pacing)                 (lead metric; see m4-format.mjs)
//         -> lock     = smallest q where the pattern realigns within an hour
//         -> cume     = simulated week-to-week repeat in the cume-priority blocks
//
// Drift and cume are NOT the same test. Drift governs the hour-of-day pattern; cume
// also depends on depth-vs-slot-pattern resonance, which is why it is non-monotonic —
// one song either way can move it 20 points.
//
// usage: node tools/depth-solver.mjs
import { weekSlots, cellFor, SHAPES, CUR, REC, GOLD, RESIDENCY_WEEKS, DEPTH } from "./m4-format.mjs";

/** Target turnover band per category, from the Alternative CHR ladder (FORMAT-WORKFLOW §0a). */
const BAND = {
  A1: [4.5, 6.0], A2: [7.0, 10.0], B: [10.0, 13.5], C: [13.0, 17.0], N: [13.0, 18.0],
  R1: [24, 34], R2: [34, 46], R3: [46, 62], Discovery: [28, 38],
  G2010: [70, 95], G2000: [95, 122], G1990: [115, 148], H: [140, 178],
};
/** Cume-repeat tolerance. Currents run hot by design; everything else should be near zero. */
const TOL = { A1: 0.50, A2: 0.25, B: 0.20, C: 0.10, N: 0.10 };
const CUME_BLOCKS = ["ES", "HD", "FF"];

const slots = weekSlots();
const byCat = new Map();
for (const s of slots) {
  if (!byCat.has(s.cat)) byCat.set(s.cat, []);
  byCat.get(s.cat).push({ ...s, block: null });
}
// attach the owning block to each slot
for (const [cat, list] of byCat) {
  for (const s of list) s.block = cellFor(s.dow, s.hour);
}

const hourDistance = (a, b) => { const d = Math.abs(a - b) % 24; return Math.min(d, 24 - d); };
const drift = (T) => (24 / T) % 1;
function lockDays(T, tolH = 1) {
  const f = drift(T);
  for (let q = 1; q <= 60; q++) if (Math.abs(f * q - Math.round(f * q)) * T < tolH) return q;
  return 999; // never realigns inside two months — reported as >60d
}

/** Week-to-week repeat in the cume blocks, with pool turnover and the horizontal rule. */
function cumeRepeat(cat, depth, rule, weeks) {
  const cs = byCat.get(cat) ?? [];
  const R = RESIDENCY_WEEKS[cat] ?? 999;
  let nextId = depth;
  const ids = Array.from({ length: depth }, (_, i) => i);
  const born = Array.from({ length: depth }, (_, i) => -Math.floor((i * R) / depth));
  const plays = new Map(), last = new Map();
  for (const i of ids) { plays.set(i, []); last.set(i, -Infinity); }
  const cell = new Map();
  for (let w = 0; w < weeks; w++) {
    if (R < 999) for (let k = 0; k < ids.length; k++) if (w - born[k] >= R) {
      const n = nextId++; ids[k] = n; born[k] = w; plays.set(n, []); last.set(n, -Infinity);
    }
    for (const s of cs) {
      if (!CUME_BLOCKS.includes(s.block)) { // still consumed, just not measured
        const ord = [...ids].sort((a, b) => last.get(a) - last.get(b));
        const pk = ord[0]; plays.get(pk).push(w * 168 + s.dow * 24 + s.hour); last.set(pk, w * 168 + s.dow * 24 + s.hour);
        continue;
      }
      const ah = w * 168 + s.dow * 24 + s.hour;
      const ord = [...ids].sort((a, b) => last.get(a) - last.get(b));
      let pick = ord[0];
      if (rule) {
        const ok = ord.find((i) => !plays.get(i).some(
          (x) => ah - x < rule.minDays * 24 && hourDistance(x % 24, s.hour) < rule.windowHours));
        if (ok !== undefined) pick = ok;
      }
      plays.get(pick).push(ah); last.set(pick, ah);
      const k = s.dow * 24 + s.hour;
      if (!cell.has(k)) cell.set(k, []);
      cell.get(k).push({ week: w, song: pick });
    }
  }
  let same = 0, pairs = 0;
  for (const v of cell.values()) {
    const bw = new Map();
    for (const x of v) { if (!bw.has(x.week)) bw.set(x.week, new Set()); bw.get(x.week).add(x.song); }
    const ws = [...bw.keys()].sort((a, b) => a - b);
    for (let i = 1; i < ws.length; i++) {
      pairs++;
      if ([...bw.get(ws[i])].some((x) => bw.get(ws[i - 1]).has(x))) same++;
    }
  }
  return pairs ? same / pairs : 0;
}

function bestRule(cat, depth, weeks) {
  let best = { cume: cumeRepeat(cat, depth, null, weeks), rule: null };
  for (const windowHours of [1, 2, 3]) for (const minDays of [1, 2, 3, 4, 5, 7, 10]) {
    const c = cumeRepeat(cat, depth, { windowHours, minDays }, weeks);
    if (c < best.cume - 0.005) best = { cume: c, rule: { windowHours, minDays } };
  }
  return best;
}

const ORDER = [...CUR, ...REC, "Discovery", ...GOLD];
const results = {};
for (const cat of ORDER) {
  const w = (byCat.get(cat) ?? []).length;
  if (!w || !BAND[cat]) continue;
  const [lo, hi] = BAND[cat];
  const weeks = Math.min(52, Math.max(16, (RESIDENCY_WEEKS[cat] ?? 12) * 3));
  const dLo = Math.max(3, Math.ceil((lo * w) / 168)), dHi = Math.floor((hi * w) / 168);
  const cands = [];
  for (let d = dLo; d <= dHi; d++) {
    const T = (168 * d) / w, pacing = 24 / T, f = drift(T);
    if (Math.min(f, 1 - f) < 0.12) continue;            // pattern barely moves each day
    const lock = lockDays(T);
    if (lock < (pacing > 2.5 ? 2 : 4)) continue;         // realigns too soon
    const heavy = d > 60;                                // gold: simulation is redundant, all ~0
    const { cume, rule } = heavy ? { cume: 0, rule: null } : bestRule(cat, d, weeks);
    if (TOL[cat] != null && cume > TOL[cat]) continue;
    cands.push({ d, T, pacing, f, lock, cume, rule });
  }
  cands.sort((a, b) => (b.lock - a.lock) || (a.cume - b.cume));
  results[cat] = cands;
}

// Currents must form a pyramid: depth increasing, pacing decreasing, and each tier
// meaningfully lighter than the one above. Without the ratio band the solver maximises
// lock days and collapses the ladder — C and N landed at 1.44 and 1.40 plays/day,
// which is not two tiers, it is one tier with two names.
// N is the new-music entry pool, not the lightest rung of the power ladder. Forcing it
// below C is unsatisfiable — its turnover band does not reach that low — and produced a
// collision at 1.40 vs 1.44 plays/day. By pacing it belongs between B and C.
const LADDER = ["A1", "A2", "B", "N", "C"];
const RATIO = [0.60, 0.88];
const pyramid = [];
let prevD = 0, prevP = Infinity;
for (const cat of LADDER) {
  const ok = (results[cat] ?? []).filter((c) =>
    c.d > prevD && (prevP === Infinity || (c.pacing / prevP >= RATIO[0] && c.pacing / prevP <= RATIO[1])));
  const pick = ok[0] ?? (results[cat] ?? []).find((c) => c.d > prevD && c.pacing < prevP);
  if (!pick) { pyramid.push([cat, null]); continue; }
  prevD = pick.d; prevP = pick.pacing;
  pyramid.push([cat, pick]);
}

console.log("## Solved depths\n");
console.log("| Category | **Depth** | Slots/wk | Turnover | Pacing | Drift | Lock | Cume | Rule | Have | Δ |");
console.log("|---|---|---|---|---|---|---|---|---|---|---|");
const final = {};
for (const [cat, pick] of pyramid) {
  if (!pick) { console.log(`| ${cat} | **none satisfies** | | | | | | | | | |`); continue; }
  final[cat] = pick.d;
  const have = DEPTH[cat] ?? 0;
  console.log(`| ${cat} | **${pick.d}** | ${byCat.get(cat).length} | ${pick.T.toFixed(2)}h | ${pick.pacing.toFixed(2)} | ${pick.f.toFixed(3)} | ${pick.lock >= 999 ? ">60" : pick.lock}d | ${(pick.cume * 100).toFixed(0)}% | ${pick.rule ? `±${pick.rule.windowHours}h/${pick.rule.minDays}d` : "—"} | ${have} | ${have - pick.d >= 0 ? "+" : ""}${have - pick.d} |`);
}
for (const cat of [...REC, "Discovery", ...GOLD]) {
  const pick = (results[cat] ?? [])[0];
  if (!pick) { console.log(`| ${cat} | **none satisfies** | | | | | | | | | |`); continue; }
  final[cat] = pick.d;
  const have = DEPTH[cat] ?? 0;
  console.log(`| ${cat} | **${pick.d}** | ${byCat.get(cat).length} | ${pick.T.toFixed(2)}h | ${pick.pacing.toFixed(2)} | ${pick.f.toFixed(3)} | ${pick.lock >= 999 ? ">60" : pick.lock}d | ${(pick.cume * 100).toFixed(0)}% | ${pick.rule ? `±${pick.rule.windowHours}h/${pick.rule.minDays}d` : "—"} | ${have} | ${have - pick.d >= 0 ? "+" : ""}${have - pick.d} |`);
}
console.log("\nDEPTH_TARGET = " + JSON.stringify(final));
const tot = Object.values(final).reduce((a, b) => a + b, 0);
const haveTot = Object.keys(final).reduce((a, c) => a + (DEPTH[c] ?? 0), 0);
console.log(`\ntotal library: ${tot} songs targeted, ${haveTot} present, net ${tot - haveTot >= 0 ? "+" : ""}${tot - haveTot}`);
