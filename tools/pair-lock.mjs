// Cross-category lock, computed exactly rather than sampled.
//
// A category's FIFO pointer sits at (week * slots_wk) mod depth at the start of each
// week, so its whole rotation returns to phase after
//     cycle = depth / gcd(slots_wk, depth)   weeks.
// A specific pairing of one song from category X with one from category Y, in a
// specific (day, hour) cell, therefore recurs every lcm(cycle_X, cycle_Y) weeks.
//
// A short single-category cycle means that category relocks to the same slots weekly.
// A short pairwise lcm means listeners hear the same two songs together on a schedule.
//
// An earlier version of this file sampled 12 weeks and counted repeats; it reported
// "no lock" even for deliberately resonant depths, because the recurrence periods are
// longer than the sampling window. It measured nothing. This replaces it.
//
// usage: node tools/pair-lock.mjs [preset]
import { weekSlots, CUR, REC, GOLD } from "./m4-format.mjs";

const PRESETS = {
  recommended: { A1:7, A2:21, B:25, C:22, N:24, R1:22, R2:34, R3:42, Discovery:13, G2010:165, G2000:155, G1990:186, H:100 },
  current:     { A1:7, A2:10, B:19, C:22, N:8,  R1:22, R2:34, R3:42, Discovery:12, G2010:165, G2000:150, G1990:186, H:94 },
  resonant:    { A1:7, A2:14, B:21, C:28, N:35, R1:42, R2:49, R3:56, Discovery:63, G2010:70, G2000:77, G1990:84, H:91 },
};
const D = PRESETS[process.argv[2] ?? "recommended"];

const gcd = (a, b) => (b ? gcd(b, a % b) : a);
const lcm = (a, b) => (a / gcd(a, b)) * b;

const slots = weekSlots();
const SLOTS = {};
for (const s of slots) SLOTS[s.cat] = (SLOTS[s.cat] ?? 0) + 1;

const cats = [...CUR, ...REC, "Discovery", ...GOLD].filter((c) => SLOTS[c] && D[c]);
const cycle = {};
for (const c of cats) cycle[c] = D[c] / gcd(SLOTS[c], D[c]);

console.log(`## Cross-category lock — preset "${process.argv[2] ?? "recommended"}"\n`);
console.log("### Single-category relock\n");
console.log("A category whose whole rotation returns to phase in N weeks puts the same songs");
console.log("back in the same slots every N weeks.\n");
console.log("| Category | Slots/wk | Depth | gcd | Relock cycle |");
console.log("|---|---|---|---|---|");
for (const c of cats) {
  const g = gcd(SLOTS[c], D[c]);
  const flag = cycle[c] < 8 ? " ⚠" : "";
  console.log(`| ${c} | ${SLOTS[c]} | ${D[c]} | ${g} | ${cycle[c]} wk${flag} |`);
}

console.log("\n### Pairwise co-occurrence recurrence (weeks)\n");
const pairs = [];
for (let i = 0; i < cats.length; i++)
  for (let j = i + 1; j < cats.length; j++)
    pairs.push({ a: cats[i], b: cats[j], w: lcm(cycle[cats[i]], cycle[cats[j]]) });
pairs.sort((x, y) => x.w - y.w);

console.log("Twelve tightest pairings — how often a specific two-song combination returns:\n");
console.log("| Pair | Cycles | Recurs every |");
console.log("|---|---|---|");
for (const p of pairs.slice(0, 12)) {
  const flag = p.w < 12 ? " ⚠" : "";
  console.log(`| ${p.a} + ${p.b} | ${cycle[p.a]} / ${cycle[p.b]} | ${p.w} wk${flag} |`);
}
const worst = pairs[0];
console.log(
  `\nTightest pairing: **${worst.a} + ${worst.b}** every **${worst.w} weeks**. ` +
    `Median across all ${pairs.length} pairs: ${pairs[Math.floor(pairs.length / 2)].w} weeks.`
);
