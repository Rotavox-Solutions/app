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
import { pathToFileURL } from "node:url";
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
  G2010: "G2000", G2000: "G1990", G1990: "G2010", H1: "G1990", H2: "H1",
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
 * Pairing policy for categories that are musically related. Two blocks may carry the
 * same counts and differ only in whether those categories sit together.
 *
 *   group    — place the second immediately after the first, as a deliberate set
 *   separate — guarantee at least one other track between them, so each arrives alone
 *
 * Golden Hour uses this to run an A/B pair: GHa groups the two pre-1990 tiers into a
 * vintage moment, GHb holds them apart so each old record is a surprise on its own.
 */
const PAIRING = {};

/**
 * Explicit vintage layout for the Golden Hour variants, by MUSIC-SLOT index (1-based,
 * counting only music positions). At ~215s mean effective length a music slot is about
 * 3.6 minutes, so slot n begins near minute (n-1) x 3.6.
 *
 * Every hour carries exactly one H1/H2 PAIR — a deliberate vintage moment — plus one
 * lone H1 and one lone H2 placed well clear of the pair and of each other. The variants
 * differ in which half of the hour holds the pair:
 *
 *   GHa  pair at slots 5-6   (~:14-:21)   lone items in the back half
 *   GHb  pair at slots 12-13 (~:40-:47)   lone items in the front half
 *
 * Explicit rather than algorithmic: this is a musical decision about where a moment
 * belongs in an hour, and it should read as one in the source rather than emerge from
 * a scatter heuristic.
 */
const VINTAGE_LAYOUT = {
  GHa: { 5: "H1", 6: "H2", 11: "H2", 14: "H1" },
  GHb: { 3: "H2", 8: "H1", 12: "H1", 13: "H2" },
};

/**
 * Music slot that must not have imaging inserted before it, because it is the second
 * half of a declared pair. Without this the imaging weave will happily drop a Gold
 * Backsell between H1 and H2 when the run limit falls there — which un-pairs the very
 * thing the layout exists to create.
 */
const PAIR_SECOND = { GHa: 6, GHb: 13 };

/** Max consecutive music items/** Max consecutive music items before imaging must break the sweep, per block. */
const MAX_RUN = { ES: 2, FF: 2, HD: 2, WW: 3, EM: 3, CO: 3, WD: 3, DNa: 4, DNb: 4, GHa: 4, GHb: 4 };

/** Spread `n` items of a group evenly across `total` slots: ideal index per item. */
const ideal = (k, n, total) => (k + 0.5) * total / n;

/**
 * Two-level proportional placement.
 *
 * Placing every category independently is wrong: three recurrent tiers with one
 * position each all resolve to the same midpoint and stack up. Tier is what the
 * listener hears — current, gold, recurrent — so tiers are spread first, then the
 * specific categories are spread within their own tier's slots.
 */
function orderMusic(shape, code) {
  const layout = VINTAGE_LAYOUT[code];
  if (layout) {
    const held = new Set(Object.values(layout));
    const rest = Object.fromEntries(Object.entries(shape).filter(([c]) => !held.has(c)));
    const filler = orderMusicProportional(rest);
    const total = Object.values(shape).reduce((a, b) => a + b, 0);
    const out = new Array(total).fill(null);
    for (const [slot, cat] of Object.entries(layout)) out[Number(slot) - 1] = cat;
    let f = 0;
    for (let i = 0; i < total; i++) if (out[i] === null) out[i] = filler[f++];
    return out;
  }
  return orderMusicProportional(shape);
}

function orderMusicProportional(shape) {
  const total = Object.values(shape).reduce((a, b) => a + b, 0);
  const tiers = {};
  for (const [cat, n] of Object.entries(shape)) {
    const t = tierOf(cat);
    (tiers[t] ??= { n: 0, cats: {} });
    tiers[t].n += n;
    tiers[t].cats[cat] = n;
  }
  // 1. spread tiers across the hour
  const want = [];
  for (const [t, info] of Object.entries(tiers))
    for (let k = 0; k < info.n; k++) want.push({ tier: t, at: ideal(k, info.n, total) });
  want.sort((a, b) => a.at - b.at || a.tier.localeCompare(b.tier));

  // 2. within each tier, spread its categories across that tier's own slots
  const perTier = {};
  for (const [t, info] of Object.entries(tiers)) {
    const list = [];
    for (const [cat, n] of Object.entries(info.cats))
      for (let k = 0; k < n; k++) list.push({ cat, at: ideal(k, n, info.n) });
    list.sort((a, b) => a.at - b.at || a.cat.localeCompare(b.cat));
    perTier[t] = list.map((x) => x.cat);
  }
  const cursor = {};
  const out = want.map((w) => perTier[w.tier][(cursor[w.tier] = (cursor[w.tier] ?? -1) + 1)]);

  // 3. break any adjacent duplicates by swapping with the nearest safe neighbour
  for (let pass = 0; pass < 4; pass++)
    for (let i = 1; i < out.length; i++) {
      if (out[i] !== out[i - 1]) continue;
      for (let d = 1; d < out.length; d++) {
        let done = false;
        for (const j of [i + d, i - d]) {
          if (j < 1 || j >= out.length || out[j] === out[i]) continue;
          const free = (v, a, b) => v !== out[a] && v !== out[b];
          if (free(out[j], i - 1, i + 1) && free(out[i], j - 1, j + 1)) {
            [out[i], out[j]] = [out[j], out[i]]; done = true; break;
          }
        }
        if (done) break;
      }
    }
  return out;
}

/**
 * Enforce the block's pairing policy after proportional placement. Placement spreads by
 * tier and both pre-1990 tiers are gold, so whether they land together is otherwise an
 * accident of arithmetic rather than a decision.
 */
function applyPairing(out, policy) {
  if (!policy) return;
  const [a, b] = policy.pair;

  if (policy.mode === "group") {
    // Lift every b out first, then reinsert one after each a. Mutating in place while
    // reading indices is what produced the earlier bug — both b's clustered onto one a
    // and the second a was left orphaned.
    const bCount = out.filter((c) => c === b).length;
    for (let i = out.length - 1; i >= 0; i--) if (out[i] === b) out.splice(i, 1);
    const aIdx = out.reduce((acc, c, i) => (c === a ? [...acc, i] : acc), []);
    // insert back-to-front so the earlier indices stay valid
    let placed = 0;
    for (let k = aIdx.length - 1; k >= 0 && placed < bCount; k--, placed++) {
      out.splice(aIdx[k] + 1, 0, b);
    }
    // any surplus b beyond the number of a's goes back at the end of the gold run
    for (; placed < bCount; placed++) out.splice(Math.floor(out.length / 2), 0, b);
    return;
  }

  // separate: spread all four vintage items evenly across the hour, alternating the two
  // tiers. Merely breaking adjacency is not enough — the first attempt did that and
  // still left both H2s inside the opening quarter, which is separated but not spread.
  const items = [];
  for (let i = out.length - 1; i >= 0; i--) {
    if (out[i] === a || out[i] === b) { items.push(out[i]); out.splice(i, 1); }
  }
  if (!items.length) return;
  const as = items.filter((c) => c === a);
  const bs = items.filter((c) => c === b);
  const order = [];
  while (as.length || bs.length) {
    if (bs.length) order.push(bs.pop());
    if (as.length) order.push(as.pop());
  }
  const span = out.length;
  for (let k = order.length - 1; k >= 0; k--) {
    const at = Math.min(span, Math.max(1, Math.round(((k + 0.5) * span) / order.length)));
    out.splice(at, 0, order[k]);
  }
}

/**
 * Weave imaging so no music sweep exceeds MAX_RUN, choosing contextually where the
 * choice exists: a New-Music sweeper ahead of a new track, a Gold Backsell behind a
 * gold one, a Relaunch sweeper ahead of a current.
 */
function weave(music, imaging, code) {
  const noBreakBefore = PAIR_SECOND[code] ?? null;
  const tohCat = `TOH ${code.startsWith("DN") ? "DN" : code.startsWith("GH") ? "GH" : code}`;
  const pool = { ...imaging };
  delete pool[tohCat];
  const take = (pref) => {
    for (const c of pref) if ((pool[c] ?? 0) > 0) { pool[c]--; return c; }
    const c = Object.keys(pool).find((k) => pool[k] > 0);
    if (c) { pool[c]--; return c; }
    return null;
  };
  const left = () => Object.values(pool).reduce((a, b) => a + b, 0);

  const out = [{ cat: tohCat, kind: "imaging" }];
  const maxRun = MAX_RUN[code] ?? 3;
  let run = 0;
  for (let i = 0; i < music.length; i++) {
    const cat = music[i];
    const remainingMusic = music.length - i;
    // i is 0-based over music items; the layout counts music slots from 1
    const isPairSecond = noBreakBefore != null && i + 1 === noBreakBefore;
    if (run >= maxRun && left() > 0 && !isPairSecond) {
      const prev = music[i - 1], next = cat;
      const pref = [];
      if (GOLD.includes(prev)) pref.push("Gold Backsells");
      if (next === "N" || next === "A1") pref.push("New-Music Sweepers");
      if (next === "A1" || next === "A2") pref.push("Relaunch Sweepers");
      pref.push("Liners", "Station Promos");
      out.push({ cat: take(pref), kind: "imaging" });
      run = 0;
    }
    out.push({ cat, kind: "music" });
    run++;
    // dump any surplus imaging rather than stacking it at the end
    const nextIsPairSecond = noBreakBefore != null && i + 2 === noBreakBefore;
    if (left() > 0 && remainingMusic > 1 && !nextIsPairSecond &&
        left() >= Math.ceil(remainingMusic / maxRun)) {
      out.push({ cat: take(["Station Promos", "Liners"]), kind: "imaging" });
      run = 0;
    }
  }
  while (left() > 0) out.push({ cat: take(["Liners", "Station Promos"]), kind: "imaging" });
  return out;
}

/**
 * The ordered position list for one block's clock: music placed by two-level
 * proportional spread, imaging woven in contextually, TOH first. Exported so the M4 seed
 * generator emits exactly what this tool reports -- the seed cannot drift from the
 * format definition because both read the same function.
 */
export function clockSequence(code) {
  return weave(orderMusic(SHAPES[code], code), IMAGING[code], code);
}

export const fallbackFor = (cat, code) =>
  cat.startsWith("TOH ") ? tohFallback(code) : (FALLBACK[cat] ?? null);

function render(code) {
  const seq = clockSequence(code);
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

// Report only when run directly. Importing this module must have NO side effects --
// tools/m4-seed.mjs imports clockSequence() and any top-level console.log here lands
// in the middle of the generated SQL.
const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? "").href;
const only = isMain ? process.argv[2] : undefined;
if (!isMain) { /* imported: emit nothing */ }
else if (only) render(only);
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
    H1: "era-adjacent; alt heritage is thin, so it is never a fallback target",
    H2: "falls to H1 — keeps the vintage texture rather than snapping back to 90s alt",
    Discovery: "new music is the nearest neighbour",
    "New-Music Sweepers": "generic imaging", "Relaunch Sweepers": "generic imaging",
    "Gold Backsells": "generic imaging", "Station Promos": "generic imaging",
    Liners: "no fallback — a wrong-context liner is worse than none",
  };
  for (const [k, v] of Object.entries(FALLBACK)) console.log(`| ${k} | ${v ?? "—"} | ${why[k]} |`);
  console.log(`| TOH * | Liners | a missing ID should not cost the slot |`);
}
