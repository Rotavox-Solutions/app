// Expected freshness WITH the horizontal separation rule applied.
//
// rotation-sim.mjs measures the passive case: strict FIFO, no rule, which is what the
// engine degrades to on an untagged library. This models the rule from
// packages/engine/src/candidates.ts — pick the least-recently-played candidate that
// has NOT played within `windowHours` of this slot's hour-of-day in the last
// `minDays`; if none qualifies, the rule yields (it sits on the secondary-hard rung)
// and the least-recent candidate is taken anyway.
//
// The yield rate is as important as the freshness number: a rule that yields on most
// slots is not working, and in the real engine a yield means the ladder relaxed.
//
// usage: node tools/rule-sim.mjs [weeks]
import { weekSlots, DEPTH, CUR, REC, GOLD, BLOCKS, cellFor, SHAPES } from "./m4-format.mjs";

const WEEKS = Number(process.argv[2] ?? 26);

const DEPTH_TARGET = {
  A1: 11, A2: 11, B: 19, C: 19, N: 17,
  R1: 29, R2: 43, R3: 70, Discovery: 29,
  G2010: 155, G2000: 99, G1990: 163, H: 70,
};

/**
 * Per-category rule parameters, from the sweep in this file's companion analysis.
 *
 * The counter-intuitive result: the rule HELPS only where the pool is too shallow to
 * precess on its own. Where passive FIFO already reaches ~100% freshness — every
 * recurrent, gold and Discovery pool — the rule can only subtract, because it removes
 * choice from a rotation that was already optimal, and its cool-down-then-return
 * rhythm can resynchronise with the weekly grid. Applying it there costs 5-21pp.
 *
 * So it is scoped to currents only. null = no rule.
 */
// Parameters are chosen subject to a <=25% YIELD CAP. That constraint improves both
// metrics rather than trading against them: an unconstrained sweep picked A1 +-1h/10d,
// which yields on 69% of slots and scores 25% repeat, where +-1h/4d yields on 5% and
// scores 9%. A rule that cannot be satisfied does not schedule — it just makes the
// engine relax, and in the engine a yield drops album separation and tempo clash too.
const PARAMS = {
  A1: { windowHours: 1, minDays: 4 },
  A2: { windowHours: 1, minDays: 1 },
  B: { windowHours: 1, minDays: 10 },
  C: null, // passive rotation already reaches 0% week-to-week repeat
  N: { windowHours: 2, minDays: 2 },
  R1: null, R2: null, R3: null, Discovery: null,
  G2010: null, G2000: null, G1990: null, H: null,
};
const tierOf = (c) =>
  CUR.includes(c) ? "cur" : REC.includes(c) ? "rec" : GOLD.includes(c) ? "gold" : "disc";

const hourDistance = (a, b) => { const d = Math.abs(a - b) % 24; return Math.min(d, 24 - d); };

const slots = weekSlots();
const byCat = new Map();
for (const s of slots) {
  if (!byCat.has(s.cat)) byCat.set(s.cat, []);
  byCat.get(s.cat).push(s);
}

/**
 * @param withRule when false, degrades to the plain FIFO baseline.
 * Returns { freshness, yieldRate }.
 */
/**
 * METRIC. An earlier version scored "distinct songs / total plays in a cell", which is
 * bounded by depth / (plays-per-cell x weeks) and therefore DECAYS as the observation
 * window grows, however good the rotation is — over 52 weeks A1 scores 11% no matter
 * how it is scheduled. That measured the window, not the listener.
 *
 * This measures week-to-week repeat: for a listener in a fixed weekly slot, how often
 * does this week repeat a song from last week. Stable across window length, and it is
 * the stated concern — hearing at 9am today what you heard at 9am yesterday.
 * LOWER IS BETTER.
 */
function simulate(cat, depth, withRule) {
  const catSlots = byCat.get(cat) ?? [];
  const plays = Array.from({ length: depth }, () => []); // absolute hour indexes
  const lastPlay = new Array(depth).fill(-Infinity);
  const cell = new Map();
  const p = PARAMS[cat];
  let yields = 0, total = 0;

  for (let w = 0; w < WEEKS; w++) {
    for (const s of catSlots) {
      const absHour = w * 168 + s.dow * 24 + s.hour;
      // least-recently-played order
      const order = Array.from({ length: depth }, (_, i) => i).sort((a, b) => lastPlay[a] - lastPlay[b]);
      let pick = order[0];
      if (withRule && p) {
        const ok = order.find((i) =>
          !plays[i].some(
            (t) => absHour - t < p.minDays * 24 && hourDistance(t % 24, s.hour) < p.windowHours
          )
        );
        if (ok === undefined) yields++;
        else pick = ok;
      }
      total++;
      plays[pick].push(absHour);
      lastPlay[pick] = absHour;
      const k = s.dow * 24 + s.hour;
      if (!cell.has(k)) cell.set(k, []);
      cell.get(k).push({ week: w, song: pick });
    }
  }

  let same = 0, pairs = 0;
  for (const seen of cell.values()) {
    const byWeek = new Map();
    for (const x of seen) {
      if (!byWeek.has(x.week)) byWeek.set(x.week, new Set());
      byWeek.get(x.week).add(x.song);
    }
    const ws = [...byWeek.keys()].sort((a, b) => a - b);
    for (let i = 1; i < ws.length; i++) {
      pairs++;
      if ([...byWeek.get(ws[i])].some((x) => byWeek.get(ws[i - 1]).has(x))) same++;
    }
  }
  return { repeat: pairs ? same / pairs : 0, yieldRate: total ? yields / total : 0 };
}

console.log(`## Expected freshness with the horizontal rule — ${WEEKS} weeks\n`);
console.log("Rule applied to CURRENTS ONLY — see PARAMS for why.\n");
console.log("Week-to-week repeat rate — share of weeks a fixed-slot listener hears a song");
console.log("they heard in that slot last week. LOWER IS BETTER.\n");
console.log("| Category | Depth | Plays/day | Passive | **With rule** | Change | Rule yielded |");
console.log("|---|---|---|---|---|---|---|");
let wSum = 0, wTot = 0;
for (const cat of [...CUR, ...REC, "Discovery", ...GOLD]) {
  const d = DEPTH_TARGET[cat];
  const w = (byCat.get(cat) ?? []).length;
  if (!d || !w) continue;
  const off = simulate(cat, d, false);
  const on = simulate(cat, d, true);
  const gain = on.repeat - off.repeat;
  console.log(
    `| ${cat} | ${d} | ${(24 / (168 * d / w)).toFixed(2)} | ${(off.repeat * 100).toFixed(0)}% | **${(on.repeat * 100).toFixed(0)}%** | ${gain >= 0 ? "+" : ""}${(gain * 100).toFixed(0)}pp | ${(on.yieldRate * 100).toFixed(1)}% |`
  );
  wSum += on.repeat * w; wTot += w;
}
console.log(`\n**Slot-weighted week-to-week repeat: ${((wSum / wTot) * 100).toFixed(1)}%**`);

// ---------------------------------------------------------------------------
// PER-BLOCK breakdown. The aggregate averages over all 168 cells, which is a
// number no listener experiences: a US Eastern listener at 9am is in Eastern
// Sunrise, a Central European listener at 9am is in European Morning, and they
// never share a cell. Freshness has to be read per block.
//
// Governing relationship, from sweeping depth against density: week-to-week
// repeat stays low only while
//        depth >= ~3.5 x (plays of that category per cell per week)
// A cume-block cell carrying 3 A1/hr therefore needs ~11 A1 songs; at 4/hr it
// needs ~14. Below that the same songs necessarily recur in the slot.
// ---------------------------------------------------------------------------
const ROLE = { ES: "cume", FF: "peak", HD: "cume", CO: "TSL", WW: "TSL",
               WD: "TSL", EM: "TSL", GH: "low", DNa: "low", DNb: "low" };

function perBlock(cat, depth) {
  const cs = [];
  for (let dow = 0; dow < 7; dow++) for (let hour = 0; hour < 24; hour++) {
    const code = cellFor(dow, hour);
    const n = SHAPES[code][cat] ?? 0;
    for (let i = 0; i < n; i++) cs.push({ dow, hour, block: code });
  }
  const p = PARAMS[cat];
  const plays = Array.from({ length: depth }, () => []);
  const last = new Array(depth).fill(-Infinity);
  const cell = new Map();
  for (let w = 0; w < WEEKS; w++) for (const s of cs) {
    const ah = w * 168 + s.dow * 24 + s.hour;
    const ord = Array.from({ length: depth }, (_, i) => i).sort((a, b) => last[a] - last[b]);
    let pick = ord[0];
    if (p) {
      const ok = ord.find((i) => !plays[i].some(
        (x) => ah - x < p.minDays * 24 && hourDistance(x % 24, s.hour) < p.windowHours));
      if (ok !== undefined) pick = ok;
    }
    plays[pick].push(ah); last[pick] = ah;
    const k = s.dow * 24 + s.hour;
    if (!cell.has(k)) cell.set(k, { block: s.block, v: [] });
    cell.get(k).v.push({ week: w, song: pick });
  }
  const agg = {};
  for (const { block, v } of cell.values()) {
    const bw = new Map();
    for (const x of v) { if (!bw.has(x.week)) bw.set(x.week, new Set()); bw.get(x.week).add(x.song); }
    const ws = [...bw.keys()].sort((a, b) => a - b);
    agg[block] ??= { same: 0, pairs: 0 };
    for (let i = 1; i < ws.length; i++) {
      agg[block].pairs++;
      if ([...bw.get(ws[i])].some((x) => bw.get(ws[i - 1]).has(x))) agg[block].same++;
    }
  }
  const out = {};
  for (const [b, x] of Object.entries(agg)) out[b] = x.pairs ? x.same / x.pairs : 0;
  return out;
}

console.log("\n## Per-block week-to-week repeat — currents\n");
const curCats = CUR.filter((c) => DEPTH_TARGET[c]);
console.log("| Block | Role | hrs/wk | " + curCats.join(" | ") + " |");
console.log("|---|---|---|" + curCats.map(() => "---").join("|") + "|");
const hrs = {};
for (let d = 0; d < 7; d++) for (let h = 0; h < 24; h++) { const c = cellFor(d, h); hrs[c] = (hrs[c] ?? 0) + 1; }
const tables = Object.fromEntries(curCats.map((c) => [c, perBlock(c, DEPTH_TARGET[c])]));
for (const code of Object.keys(BLOCKS)) {
  const cells = curCats.map((c) => tables[c][code] === undefined ? "—" : `${(tables[c][code] * 100).toFixed(0)}%`);
  console.log(`| ${code} | ${ROLE[code]} | ${hrs[code]} | ${cells.join(" | ")} |`);
}
const avg = (t, ks) => { const f = ks.filter((k) => t[k] !== undefined); return f.length ? f.reduce((a, k) => a + t[k], 0) / f.length : 0; };
console.log("\n| Grouping | " + curCats.join(" | ") + " |");
console.log("|---|" + curCats.map(() => "---").join("|") + "|");
for (const [label, ks] of [["cume + peak", ["ES", "HD", "FF"]], ["TSL", ["CO", "WW", "WD", "EM"]]])
  console.log(`| ${label} | ` + curCats.map((c) => `${(avg(tables[c], ks) * 100).toFixed(0)}%`).join(" | ") + " |");
