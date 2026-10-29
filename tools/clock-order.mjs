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
import { SHAPES, IMAGING, BLOCKS, CUR, REC, GOLD, FILLER_SLOTS, cellFor, FORMAT_CYCLE_WEEKS } from "./m4-format.mjs";

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
  "Heritage Backsells": "Gold Backsells",
  "Station Promos": "Liners",
  // The 10K pools are shallow (4-10 scripts each), so each falls to the nearest
  // generic copy that still fits the spot rather than to nothing.
  Power: "Front-sell",
  "Discovery Sweepers": "Front-sell",
  "Recurrent Sweepers": "Front-sell",
  "New Music Back": "Back-sell",
  "Gold 90s": "Liners", "Gold 00s": "Liners", "Gold 10s": "Liners",
  "Front-sell": "Liners",
  "Back-sell": "Liners",
};
// A missed per-block ID should still open the hour with a station ID, not a liner.
// Falling back to Liners meant 24 TOH slots per day aired generic imaging while 12
// perfectly good station IDs sat unmapped in subcat 10.
const tohFallback = (code) => "TOH IDs";

/**
 * What a Contextual break (IMAGING in m4-format.mjs) airs, from the records either side
 * of it. Placement rules are the 10K handoff's (pool_map.json): Power only ahead of A1/A2,
 * since it claims "most played"; New Music Back after N only (pool_map.json says N and C,
 * but C is a current tier, not new music); era copy next to its own
 * decade. Every pool that fits either side is a candidate, and the one the station airs
 * least per script wins. Load is station-wide plays per day: a pick in a block costs the
 * hours per day that block runs, so a slot in FF (4.3 h/day) weighs eight times one in
 * GHa. A specific pool is dropped from the candidates once a pick would make any of its
 * scripts air more often than every MIN_GAP_H hours; the scripts are fixed for now, so
 * the depth of the pool sets how often its copy can run. Front-sell and Back-sell fit
 * everywhere, at half weight, and are the fallback when every specific pool is spent.
 * Transition Up/Down wait for energy data, and Stingers stay a manual pool.
 * New Music Front has no rule here: its scripts (subcat 55) share the New-Music Sweepers
 * category, whose count-based slot already sits ahead of N.
 *
 * SCRIPTS is the 10K render count per pool (two takes each). Update it with the library.
 */
const SCRIPTS = {
  Power: 4, "Discovery Sweepers": 6, "Recurrent Sweepers": 4, "New Music Back": 4, "Gold 90s": 3, "Gold 00s": 3, "Gold 10s": 3, "Front-sell": 8, "Back-sell": 8,
};
const GENERIC = new Set(["Front-sell", "Back-sell"]);
const ERA_SWEEPER = { G1990: "Gold 90s", G2000: "Gold 00s", G2010: "Gold 10s" };
const MIN_GAP_H = 8;
const budget = (c) => (SCRIPTS[c] * 24) / MIN_GAP_H;
// Hours per day each block runs, averaged over the format cycle.
const HOURS_PER_DAY = {};
for (let w = 0; w < FORMAT_CYCLE_WEEKS; w++) for (let d = 0; d < 7; d++) for (let h = 0; h < 24; h++) {
  const c = cellFor(d, h, w);
  HOURS_PER_DAY[c] = (HOURS_PER_DAY[c] ?? 0) + 1 / (7 * FORMAT_CYCLE_WEEKS);
}
function contextual(prev, next, used, here, code) {
  // New Music Back fits only right after an N, which a break almost never is, so it is
  // listed first and wins a tie for the few breaks that are.
  const fits = [];
  if (prev === "N") fits.push("New Music Back");
  if (next === "A1" || next === "A2") fits.push("Power");
  if (next === "Discovery") fits.push("Discovery Sweepers");
  if (REC.includes(next)) fits.push("Recurrent Sweepers");
  if (ERA_SWEEPER[next]) fits.push(ERA_SWEEPER[next]);
  if (ERA_SWEEPER[prev] && ERA_SWEEPER[prev] !== ERA_SWEEPER[next]) fits.push(ERA_SWEEPER[prev]);
  // Which generic goes first on a tie alternates by block, so neither starves.
  const generics = [prev && "Back-sell", next && "Front-sell"].filter(Boolean);
  if (Object.keys(BLOCKS).indexOf(code) % 2) generics.reverse();
  fits.push(...generics);
  const cost = HOURS_PER_DAY[code] ?? 0;
  const inBudget = fits.filter((c) => GENERIC.has(c) || (used[c] ?? 0) + cost <= budget(c));
  // A pool airs at most once per clock while anything else fits.
  const fresh = inBudget.filter((c) => !here.has(c));
  const open = fresh.length ? fresh : inBudget;
  // Generic copy counts double, so a specific fit wins until it has aired twice as often
  // per script as the generic pools.
  const load = (c) => ((used[c] ?? 0) / SCRIPTS[c]) * (GENERIC.has(c) ? 2 : 1);
  const pick = open.reduce((best, c) => (load(c) < load(best) ? c : best));
  used[pick] = (used[pick] ?? 0) + cost;
  here.add(pick);
  return pick;
}

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

/**
 * Max consecutive music items before imaging must break the sweep, per block.
 *
 * Scaled to each block's cume profile: peak blocks break every 2, Deep Night runs 5 --
 * in low-cume long-session hours interruption costs more than identity.
 *
 * Four is the floor everywhere except the peak blocks: at ~3.5 min a song that is one
 * break per quarter-hour, which is the rhythm the format is built on.
 *
 * A cap is only meetable if the block owns enough imaging to meet it. Deep Night at
 * 15 music slots needs three internal breaks (4/8/12) and therefore three usable items;
 * with two it produced a seven-song run regardless of what the cap said. Lowering a cap
 * without adding inventory makes worst-case sweeps LONGER, not shorter.
 */
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
const TIED = {
  "Heritage Backsells": (prev) => prev === "H1" || prev === "H2",
  "Gold Backsells": (prev) => GOLD.includes(prev),
  "New-Music Sweepers": (prev, next) => next === "N",
  "Relaunch Sweepers": (prev, next) => next === "A1" || next === "A2",
};
function weave(music, imaging, code, used) {
  const noBreakBefore = PAIR_SECOND[code] ?? null;
  const tohCat = `TOH ${code.startsWith("DN") ? "DN" : code.startsWith("GH") ? "GH" : code}`;
  const pool = { ...imaging };
  delete pool[tohCat];
  const here = new Set();
  // When the preferred pools are spent, take() falls back to any pool with count left. A
  // context-tied pool picked that way airs out of context (a Gold Backsell after R3, a
  // New-Music sweeper ahead of G2010), so it becomes a Contextual break instead.
  const take = (pref, prev, next) => {
    const c = pref.find((k) => (pool[k] ?? 0) > 0) ?? Object.keys(pool).find((k) => pool[k] > 0);
    if (!c) return null;
    pool[c]--;
    if (c === "Contextual" || (TIED[c] && !TIED[c](prev, next))) return contextual(prev, next, used, here, code);
    return c;
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
    // A declared pair may not be split, but it also may not be used to smuggle a longer
    // sweep past the cap. If the next item is the pair's second and breaking there would
    // be forbidden, break one item EARLY instead.
    const justBeforePair = noBreakBefore != null && i + 2 === noBreakBefore;
    const mustBreakEarly = justBeforePair && run >= maxRun - 1;
    if ((run >= maxRun || mustBreakEarly) && left() > 0 && !isPairSecond) {
      const prev = music[i - 1], next = cat;
      const pref = [];
      // Heritage first where it applies: a pre-1990 record backsold with gold copy
      // written for the 2010s undersells the format's own differentiator. Falls through
      // to Gold Backsells wherever heritage copy is unavailable or unallocated.
      if (prev === "H1" || prev === "H2") pref.push("Heritage Backsells");
      if (GOLD.includes(prev)) pref.push("Gold Backsells");
      // N only: N is the new-music category. A1 is the top current tier, not new music.
      if (next === "N") pref.push("New-Music Sweepers");
      if (next === "A1" || next === "A2") pref.push("Relaunch Sweepers");
      pref.push("Contextual", "Liners", "Station Promos");
      out.push({ cat: take(pref, prev, next), kind: "imaging" });
      run = 0;
    }
    out.push({ cat, kind: "music" });
    run++;
    // dump any surplus imaging rather than stacking it at the end
    const nextIsPairSecond = noBreakBefore != null && i + 2 === noBreakBefore;
    if (left() > 0 && remainingMusic > 1 && !nextIsPairSecond &&
        left() >= Math.ceil(remainingMusic / maxRun)) {
      // Promos lead the surplus, except where the break lands after an N, next to a G2000
      // or ahead of A1/A2: the only spots New Music Back, Gold 00s and Power fit, and the
      // cap-driven breaks rarely fall there, so the Contextual goes there.
      const rare = cat === "N" || cat === "G2000" || ["G2000", "A1", "A2"].includes(music[i + 1]);
      const pref = rare ? ["Contextual", "Station Promos", "Liners"] : ["Station Promos", "Contextual", "Liners"];
      out.push({ cat: take(pref, cat, music[i + 1]), kind: "imaging" });
      run = 0;
    }
  }
  while (left() > 0) out.push({ cat: take(["Contextual", "Liners", "Station Promos"], music[music.length - 1]), kind: "imaging" });
  return out;
}

/**
 * The ordered position list for one block's clock: music placed by two-level
 * proportional spread, imaging woven in contextually, TOH first. Exported so the M4 seed
 * generator emits exactly what this tool reports -- the seed cannot drift from the
 * format definition because both read the same function.
 */
/**
 * Van der Corput (bit-reversal) sequence, base 2: 1/2, 1/4, 3/4, 1/8, 5/8, 3/8, 7/8 ...
 *
 * Chosen because EVERY PREFIX is well spread, which is exactly the property conditional
 * filler needs — the generator may activate 1 candidate or 6, and each count has to look
 * deliberate. Take one and it lands mid-hour; take two and they land near the thirds;
 * take three and they approach the quarters. A simple even split only spreads well at
 * its own N and clumps at every other.
 */
function vanDerCorput(k) {
  let n = k, denom = 1, x = 0;
  while (n > 0) { denom *= 2; x += (n % 2) / denom; n = Math.floor(n / 2); }
  return x;
}

// Every block is woven once, against one station-wide ledger of contextual plays per day,
// busiest block first: the hours that carry the most airtime get first claim on the
// specific pools, and the result doesn't depend on which block is asked for first.
let WOVEN = null;
function woven(code) {
  if (!WOVEN) {
    const used = {};
    const order = Object.keys(BLOCKS).sort((a, b) => (HOURS_PER_DAY[b] ?? 0) - (HOURS_PER_DAY[a] ?? 0));
    WOVEN = Object.fromEntries(order.map((c) => [c, weave(orderMusic(SHAPES[c], c), IMAGING[c], c, used)]));
  }
  return WOVEN[code].map((x) => ({ ...x }));
}

/**
 * The record a context-tied break's copy is about: "next" for copy that sells the record
 * after it, "prev" for copy about the one before, null for generic copy that fits anywhere.
 * The seed stores the anchor's slot, so when the generator sacrifices that record to land
 * the hour, the break falls back to its generic pool instead of airing out of context.
 */
const ANCHOR = {
  Power: "next", "Discovery Sweepers": "next", "Recurrent Sweepers": "next",
  "New-Music Sweepers": "next", "Relaunch Sweepers": "next",
  "New Music Back": "prev", "Gold Backsells": "prev", "Heritage Backsells": "prev",
};
const ERA_OF = Object.fromEntries(Object.entries(ERA_SWEEPER).map(([era, pool]) => [pool, era]));
function anchorSide(cat, prev, next) {
  if (ERA_OF[cat]) return next === ERA_OF[cat] ? "next" : "prev";
  return ANCHOR[cat] ?? null;
}

export function clockSequence(code) {
  const seq = fillers(woven(code), code);
  seq.forEach((x, i) => {
    if (x.kind !== "imaging") return;
    const side = anchorSide(x.cat, seq[i - 1]?.cat, seq[i + 1]?.cat);
    const j = side === "prev" ? i - 1 : side === "next" ? i + 1 : -1;
    // A filler never sits next to imaging (fillers()), so the anchor is the neighbour itself.
    if (j >= 0 && seq[j]?.kind === "music" && seq[j].cat !== "F") x.anchorIndex = j;
  });
  return seq;
}

function fillers(seq, code) {
  const n = FILLER_SLOTS[code] ?? 0;
  if (n === 0) return seq;

  // Candidate k goes after music item round(vdc(k+1) * musicCount), carrying priority
  // k+1. Inserting back-to-front keeps earlier indices valid.
  const musicIdx = seq.map((x, i) => (x.kind === "music" ? i : -1)).filter((i) => i >= 0);
  const placements = [];
  const used = new Set();

  // PRIORITY 1 IS ALWAYS THE TAIL, and it is doing a second job: it is the shear buffer.
  // An hour can start late (drift from earlier overruns) and lose its final position to
  // the immovable TOH. Whatever sits last is what gets shorn -- so the first filler the
  // generator ever activates goes there, guaranteeing the sacrifice lands on an F rather
  // than on programmed content. Spread candidates follow from that base condition.
  used.add(musicIdx.length);
  placements.push({ afterSeqIndex: musicIdx[musicIdx.length - 1], priority: 1 });

  // A filler never splits imaging from its record: a back-sell belongs right after its
  // song and a front-sell right before one, so a filler only goes between two songs. A
  // spread slot that lands next to a break moves to the nearest song-to-song gap.
  const betweenSongs = (slot) => seq[musicIdx[slot - 1] + 1]?.kind === "music";
  const nearestOpen = (slot) => {
    for (let d = 0; d < musicIdx.length; d++) {
      for (const s of [slot - d, slot + d]) {
        if (s >= 1 && s < musicIdx.length && !used.has(s) && betweenSongs(s)) return s;
      }
    }
    return null;
  };
  for (let k = 1; placements.length < n && k < n * 8; k++) {
    let slot = Math.round(vanDerCorput(k) * musicIdx.length);
    slot = Math.max(1, Math.min(musicIdx.length, slot));
    if (used.has(slot)) continue;      // collisions happen at small N; skip to the next
    slot = nearestOpen(slot);
    if (slot == null) break;
    used.add(slot);
    placements.push({ afterSeqIndex: musicIdx[slot - 1], priority: placements.length + 1 });
  }
  if (placements.length < n) throw new Error(`${code}: only ${placements.length} of ${n} fillers fit between songs`);
  placements.sort((a, b) => b.afterSeqIndex - a.afterSeqIndex);
  for (const p of placements) {
    seq.splice(p.afterSeqIndex + 1, 0, { cat: "F", kind: "music", fillerPriority: p.priority });
  }
  return seq;
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
    "Heritage Backsells": "falls to Gold Backsells — still context-correct for a gold record",
    Power: "generic front-sell", "Discovery Sweepers": "generic front-sell",
    "Recurrent Sweepers": "generic front-sell",
    "New Music Back": "generic back-sell", "Gold 90s": "generic imaging", "Gold 00s": "generic imaging",
    "Gold 10s": "generic imaging", "Front-sell": "generic imaging", "Back-sell": "generic imaging",
    Liners: "no fallback — a wrong-context liner is worse than none",
  };
  for (const [k, v] of Object.entries(FALLBACK)) console.log(`| ${k} | ${v ?? "—"} | ${why[k]} |`);
  console.log(`| TOH * | TOH IDs | a missing per-block ID still opens on a station ID |`);
}
