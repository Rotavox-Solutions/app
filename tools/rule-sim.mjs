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
import { weekSlots, DEPTH, CUR, REC, GOLD } from "./m4-format.mjs";

const WEEKS = Number(process.argv[2] ?? 12);

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
const PARAMS = {
  A1: { windowHours: 1, minDays: 5 },
  A2: { windowHours: 2, minDays: 3 },
  B: { windowHours: 1, minDays: 10 },
  C: { windowHours: 1, minDays: 10 },
  N: { windowHours: 1, minDays: 10 },
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
      cell.get(k).push(pick);
    }
  }

  let sum = 0, n = 0;
  for (const seen of cell.values()) {
    if (seen.length < 2) continue;
    sum += new Set(seen).size / seen.length;
    n++;
  }
  return { freshness: n ? sum / n : 1, yieldRate: total ? yields / total : 0 };
}

console.log(`## Expected freshness with the horizontal rule — ${WEEKS} weeks\n`);
console.log("Rule applied to CURRENTS ONLY — see PARAMS for why.\n");
console.log("| Category | Depth | Plays/day | Passive | **With rule** | Gain | Rule yielded |");
console.log("|---|---|---|---|---|---|---|");
let wSum = 0, wTot = 0;
for (const cat of [...CUR, ...REC, "Discovery", ...GOLD]) {
  const d = DEPTH_TARGET[cat];
  const w = (byCat.get(cat) ?? []).length;
  if (!d || !w) continue;
  const off = simulate(cat, d, false);
  const on = simulate(cat, d, true);
  const gain = on.freshness - off.freshness;
  console.log(
    `| ${cat} | ${d} | ${(24 / (168 * d / w)).toFixed(2)} | ${(off.freshness * 100).toFixed(0)}% | **${(on.freshness * 100).toFixed(0)}%** | ${gain >= 0 ? "+" : ""}${(gain * 100).toFixed(0)}pp | ${(on.yieldRate * 100).toFixed(1)}% |`
  );
  wSum += on.freshness * w; wTot += w;
}
console.log(`\n**Slot-weighted expected freshness: ${((wSum / wTot) * 100).toFixed(1)}%**`);
