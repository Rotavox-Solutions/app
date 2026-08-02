// Clock position ordering + fallback policy for M4.
//
// SHAPES gives counts per hour; this turns them into an air sequence. Two things the
// counts alone cannot express, and both matter:
//
//   1. Spacing. Two positions from the same category must never sit adjacent, and
//      like categories should be spread as evenly as the counts allow.
//   2. Context. Imaging is not filler — a New-Music sweeper belongs immediately
//      before a new track, a Gold Backsell immediately after a gold one.
//
// usage: node tools/clock-order.mjs [blockCode]
import { SHAPES, IMAGING, BLOCKS, CUR, REC, GOLD } from "./m4-format.mjs";

// ---- fallback policy ------------------------------------------------------------
// A position that cannot fill takes its fallback. The rule that matters: currents
// NEVER fall back to gold. M3 let them, and the result was 651 unplanned G2010 slots
// — the station sounded gold-heavy as a side effect of shallow currents, not by
// design. Currents relieve into the next current tier, then into R1, which is the
// closest thing to a current that isn't one.
export const FALLBACK = {
  A1: "A2", A2: "B", B: "C", C: "R1", N: "R1",
  R1: "R2", R2: "R3", R3: "R2",
  G2010: "G2000", G2000: "G1990", G1990: "G2010", H: "G1990",
  Discovery: "N",
  Liners: null,                       // silence is better than a wrong-context liner
  "New-Music Sweepers": "Liners",
  "Relaunch Sweepers": "Liners",
  "Gold Backsells": "Liners",
  "Station Promos": "Liners",
};
const tohFallback = (code) => "Liners";

const tierOf = (c) => (CUR.includes(c) ? "cur" : REC.includes(c) ? "rec" : GOLD.includes(c) ? "gold" : "disc");

/**
 * Proportional placement: a category with n of T positions wants its items at
 * (k + 0.5) * T / n. Sorting all ideal positions together spreads every category
 * evenly across the hour by construction, rather than greedily exhausting the
 * scarce ones first and leaving a clump of whatever is most numerous at the end.
 * A final pass swaps any adjacent duplicates apart.
 */
function orderMusic(shape) {
  const total = Object.values(shape).reduce((a, b) => a + b, 0);
  const want = [];
  for (const [cat, n] of Object.entries(shape))
    for (let k = 0; k < n; k++) want.push({ cat, at: (k + 0.5) * total / n });
  want.sort((a, b) => a.at - b.at || a.cat.localeCompare(b.cat));
  const out = want.map((w) => w.cat);

  for (let pass = 0; pass < 4; pass++) {
    for (let i = 1; i < out.length; i++) {
      if (out[i] !== out[i - 1]) continue;
      // find the nearest neighbour we can swap with without creating a new clash
      for (let d = 1; d < out.length; d++) {
        for (const j of [i + d, i - d]) {
          if (j < 0 || j >= out.length) continue;
          if (out[j] === out[i]) continue;
          const ok = (a, b) => a !== b;
          if (ok(out[j], out[i - 1]) && ok(out[j], out[i + 1] ?? null) &&
              ok(out[i], out[j - 1] ?? null) && ok(out[i], out[j + 1] ?? null)) {
            [out[i], out[j]] = [out[j], out[i]];
            d = out.length; break;
          }
        }
      }
    }
  }
  return out;
}

/** Insert imaging: TOH at the top, contextual items anchored, the rest spread evenly. */
function weave(music, imaging, code) {
  const seq = [{ cat: `TOH ${code === "DNa" || code === "DNb" ? "DN" : code}`, kind: "imaging" }];
  const img = { ...imaging };
  delete img[`TOH ${code === "DNa" || code === "DNb" ? "DN" : code}`];

  const items = music.map((c) => ({ cat: c, kind: "music" }));
  // contextual anchors first
  const anchor = (imgCat, predicate, before) => {
    while ((img[imgCat] ?? 0) > 0) {
      const idx = items.findIndex((it, i) => it.kind === "music" && predicate(it.cat) &&
        !(before ? items[i - 1]?.kind === "imaging" : items[i + 1]?.kind === "imaging"));
      if (idx < 0) break;
      items.splice(before ? idx : idx + 1, 0, { cat: imgCat, kind: "imaging" });
      img[imgCat]--;
    }
  };
  anchor("New-Music Sweepers", (c) => c === "N" || c === "A1", true);
  anchor("Gold Backsells", (c) => GOLD.includes(c), false);
  anchor("Relaunch Sweepers", (c) => c === "A1" || c === "A2", true);

  // remaining imaging spread evenly through what's left
  const rest = [];
  for (const [c, n] of Object.entries(img)) for (let i = 0; i < n; i++) rest.push(c);
  rest.forEach((c, i) => {
    const span = items.length;
    let at = Math.round((i + 0.75) * span / (rest.length + 0.5));
    at = Math.max(1, Math.min(items.length, at));
    while (at < items.length && (items[at]?.kind === "imaging" || items[at - 1]?.kind === "imaging")) at++;
    items.splice(at, 0, { cat: c, kind: "imaging" });
  });

  return [...seq, ...items];
}

function render(code) {
  const seq = weave(orderMusic(SHAPES[code]), IMAGING[code], code);
  const adjacentSame = seq.filter((x, i) => i > 0 && seq[i - 1].cat === x.cat).length;
  console.log(`\n### ${code} — ${BLOCKS[code]}  (${seq.length} positions)\n`);
  console.log("| # | Position | Type | Fallback |");
  console.log("|---|---|---|---|");
  seq.forEach((x, i) => {
    const fb = x.cat.startsWith("TOH ") ? tohFallback(code) : FALLBACK[x.cat];
    console.log(`| ${String(i + 1).padStart(2)} | ${x.cat} | ${x.kind} | ${fb ?? "—"} |`);
  });
  if (adjacentSame) console.log(`\n⚠ ${adjacentSame} adjacent same-category pair(s)`);
}

const only = process.argv[2];
if (only) render(only);
else {
  for (const code of Object.keys(BLOCKS)) render(code);
  console.log("\n### Fallback policy\n");
  console.log("| Position | Falls back to | Reason |");
  console.log("|---|---|---|");
  const why = {
    A1: "next current tier — never gold", A2: "next current tier", B: "next current tier",
    C: "hot recurrent — closest thing to a current", N: "hot recurrent",
    R1: "next recurrent tier", R2: "next recurrent tier", R3: "back up a tier, stays recurrent",
    G2010: "era-adjacent", G2000: "era-adjacent", G1990: "era-adjacent, avoids loading Heritage",
    H: "era-adjacent — Heritage is the shallowest pool, never a fallback target",
    Discovery: "new music is the nearest neighbour",
    "New-Music Sweepers": "generic imaging", "Relaunch Sweepers": "generic imaging",
    "Gold Backsells": "generic imaging", "Station Promos": "generic imaging",
    Liners: "no fallback — a wrong-context liner is worse than none",
  };
  for (const [k, v] of Object.entries(FALLBACK)) console.log(`| ${k} | ${v ?? "—"} | ${why[k]} |`);
  console.log(`| TOH * | Liners | a missing ID should not cost the slot |`);
}
