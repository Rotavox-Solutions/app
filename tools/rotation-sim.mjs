// Rotation simulator: plots where a category's songs actually land on a 24x7 grid.
//
// Supersedes the arithmetic turnover analysis, which assumed a song plays every T
// hours on a uniform schedule. It doesn't — A1 runs 3/hr in Full Footprint, 1/hr in
// European Morning and 0 in Golden Hour, so the clean period never exists. This
// simulates the engine's actual behaviour instead.
//
// The engine, with an untagged library, degrades to "rest + jitter" (scoring.ts) —
// i.e. it picks the least-recently-played candidate. That is modelled here as strict
// FIFO, which is the WORST case for scatter; real jitter can only improve on it.
//
// usage: node tools/rotation-sim.mjs [weeks] [category]
import { weekSlots, DEPTH, CUR, REC, GOLD } from "./m4-format.mjs";

const WEEKS = Number(process.argv[2] ?? 12);
const ONLY = process.argv[3];

const slots = weekSlots();
const byCat = new Map();
for (const s of slots) {
  if (!byCat.has(s.cat)) byCat.set(s.cat, []);
  byCat.get(s.cat).push(s);
}

/** Simulate one category: FIFO over `weeks`, return per-song (dow,hour) play lists. */
function simulate(cat, depth, weeks) {
  const catSlots = byCat.get(cat) ?? [];
  const plays = Array.from({ length: depth }, () => []);
  let next = 0; // FIFO pointer — least-recently-played is always the next in line
  for (let w = 0; w < weeks; w++) {
    for (const s of catSlots) {
      plays[next].push({ dow: s.dow, hour: s.hour, week: w });
      next = (next + 1) % depth;
    }
  }
  return plays;
}

/**
 * The listener-facing metric. A habitual listener occupies one (day, hour) cell every
 * week. Over N weeks that cell hosts N plays of this category — are they N different
 * songs, or a few on repeat? freshness = distinct songs / weeks observed, per cell,
 * averaged. 1.00 means never the same song twice in the same slot.
 */
function metrics(plays, weeks) {
  const cell = new Map(); // dow*24+hour -> array of song indexes, in week order
  plays.forEach((list, songIdx) => {
    for (const x of list) {
      const k = x.dow * 24 + x.hour;
      if (!cell.has(k)) cell.set(k, []);
      cell.get(k).push(songIdx);
    }
  });
  let freshSum = 0, cells = 0, worst = 1;
  for (const seen of cell.values()) {
    if (seen.length < 2) continue;
    const f = new Set(seen).size / seen.length;
    freshSum += f; cells++;
    worst = Math.min(worst, f);
  }
  // how many distinct hours-of-day a song reaches, for context
  let hoursSum = 0, n = 0;
  for (const p of plays) {
    if (!p.length) continue;
    hoursSum += new Set(p.map((x) => x.hour)).size;
    n++;
  }
  return { freshness: cells ? freshSum / cells : 1, worstCell: worst, hoursCovered: hoursSum / n };
}

function plot(cat, depth, weeks) {
  const plays = simulate(cat, depth, weeks);
  const grid = Array.from({ length: 24 }, () => new Array(7).fill(0));
  for (const x of plays[0]) grid[x.hour][x.dow]++;   // song #0 as the exemplar
  console.log(`\n### ${cat} — depth ${depth}, ${weeks} weeks, ONE song's landings\n`);
  console.log("hr | Sun Mon Tue Wed Thu Fri Sat");
  for (let h = 0; h < 24; h++) {
    const row = grid[h].map((v) => (v ? String(v).padStart(2) : " ·")).join("  ");
    console.log(`${String(h).padStart(2, "0")} | ${row}`);
  }
  const m = metrics(plays, weeks);
  console.log(
    `\nslot freshness ${(m.freshness * 100).toFixed(0)}%  ·  worst cell ${(m.worstCell * 100).toFixed(0)}%  ·  hours covered ${m.hoursCovered.toFixed(1)}/24`
  );
}

if (ONLY) {
  plot(ONLY, DEPTH[ONLY] ?? 20, WEEKS);
} else {
  console.log(`## Scatter by depth — FIFO worst case, ${WEEKS} weeks\n`);
  console.log("Freshness = for a listener in a fixed weekly slot, share of weeks they hear a DIFFERENT song.\n");
  console.log("| Category | Slots/wk | Best depth | Slot freshness | Worst cell | Hours | Runner-up depths |");
  console.log("|---|---|---|---|---|---|---|");
  for (const cat of [...CUR, ...REC, "Discovery", ...GOLD]) {
    const w = (byCat.get(cat) ?? []).length;
    if (!w) continue;
    const base = DEPTH[cat] ?? 20;
    const lo = Math.max(3, Math.floor(base * 0.4)), hi = Math.ceil(base * 1.8);
    const scored = [];
    for (let d = lo; d <= hi; d++) {
      const m = metrics(simulate(cat, d, WEEKS), WEEKS);
      scored.push({ d, ...m });
    }
    scored.sort((a, b) => b.freshness - a.freshness || b.worstCell - a.worstCell);
    const best = scored[0];
    const others = scored.slice(1, 4).map((x) => `${x.d} (${(x.freshness * 100).toFixed(0)}%)`).join(", ");
    console.log(
      `| ${cat} | ${w} | **${best.d}** | ${(best.freshness * 100).toFixed(0)}% | ${(best.worstCell * 100).toFixed(0)}% | ${best.hoursCovered.toFixed(1)} | ${others} |`
    );
  }
}
