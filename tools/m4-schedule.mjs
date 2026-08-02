// M4 proposed schedule: 8 blocks over 168 cells, clock shapes, and resulting demand.
// Derived from DAYPART-ANALYSIS.md. Re-run after editing BLOCKS or SHAPES.

// ---------- 1. block assignment per (dow, hour), station-local (PT) ----------
// dow: 0=Sun .. 6=Sat
// Deep Night alternates two variants so G2000 averages 1.5/hr; the a/b split is
// balanced to exactly 17/17 across the week (weekday 10/10, Sat 4/3, Sun 3/4).
// Deep Night is only the US-leaning trough (weekday 22, weekend 22-23). Everything
// from weekday 23:00 onward is European Morning — at 00:00 PT the block is 82% Europe
// at 09:00 local. An array value cycles its variants across the days it occurs on.
const WEEKDAY = [
  "EM","EM","CO","CO","CO","ES","ES","ES","FF","FF","FF","FF",
  "FF","FF","HD","HD","HD","WD","WD","WD","WD","GH",["DNa","DNb"],"EM",
];
const SAT = [
  "EM","EM","EM","EM","EM","CO","CO","CO","WW","WW","WW","WW",
  "WW","WW","WW","WW","WD","WD","WD","WD","WD","GH","DNb","DNa",
];
const SUN = [
  "EM","EM","EM","EM","EM","CO","CO","CO","WW","WW","WW","WW",
  "WW","WW","WW","WW","WD","WD","WD","WD","WD","GH","DNb","DNa",
];

const BLOCKS = {
  ES: "Eastern Sunrise",
  FF: "Full Footprint",
  HD: "Home Drive",
  CO: "Continental",
  WW: "Weekend Wide",
  WD: "Wind Down",
  GH: "Golden Hour",
  EM: "European Morning",
  DNa: "Deep Night A",
  DNb: "Deep Night B",
};
/** Blocks sharing one TOH ID set / one identity. */
const IDENTITY = { DNa: "DN", DNb: "DN" };
const identityOf = (code) => IDENTITY[code] ?? code;

// ---------- 2. clock shapes: category -> positions per hour ----------
const SHAPES = {
  // N (new music) is carried in every music block except Golden Hour, and doubled in
  // the two peak blocks. Positions came out of gold — a deliberate trade of gold
  // plays for new-music exposure, per PD direction 2026-08-01.
  ES: { A1:3, A2:2, B:3, C:1, N:2, R1:1, R2:1, R3:1, G2010:1, Discovery:1 },
  FF: { A1:3, A2:2, B:2, C:1, N:2, R1:1, R2:1, R3:1, G2010:2, Discovery:1 },
  HD: { A1:3, A2:1, B:2, C:2, N:1, R1:1, R2:1, R3:1, G2010:2, G2000:1, Discovery:1 },
  CO: { A1:2, A2:1, B:2, C:1, N:1, R1:1, R2:2, R3:1, G2010:2, G2000:1, G1990:1, Discovery:1 },
  WW: { A1:2, A2:1, B:1, C:1, N:1, R1:1, R2:1, R3:2, G2010:2, G2000:1, G1990:1, H:1, Discovery:1 },
  // Wind Down is ET 20-23 / PT 17-20 — the most US-dominant music block, so Heritage
  // is sited here rather than in the Europe-heavy hours it used to lean on.
  WD: { A1:1, A2:1, B:1, C:1, N:1, R1:1, R2:1, R3:2, G2010:2, G2000:1, G1990:1, H:2, Discovery:1 },
  // European Morning: CE 08-13, UK 07-12. Morning texture, Heritage as seasoning only.
  EM: { A1:1, A2:1, B:2, C:2, N:1, R1:1, R2:1, R3:1, G2010:2, G2000:1, G1990:1, H:1, Discovery:1 },
  // G2010 held at 2 — the 20-30 demo skews to off-schedule listening.
  DNa: { A1:1, C:1, N:1, R2:1, R3:1, G2010:2, G2000:2, G1990:2, H:3, Discovery:1 },
  DNb: { A1:1, C:1, N:1, R2:1, R3:1, G2010:2, G2000:1, G1990:3, H:3, Discovery:1 },
  GH:  { G2010:2, G2000:2, G1990:6, H:4, Discovery:1 },
};

// TOH IDs are per-block categories (one identity per block), so the top of the hour
// reflects what the station is at that moment. `TOH *` depths are TBD — being produced.
const IMAGING = {
  ES:  { Liners:3, "New-Music Sweepers":1, "Relaunch Sweepers":1, "Station Promos":1 },
  FF:  { Liners:3, "New-Music Sweepers":1, "Gold Backsells":1, "Station Promos":1 },
  HD:  { Liners:3, "New-Music Sweepers":1, "Relaunch Sweepers":1, "Station Promos":1 },
  CO:  { Liners:2, "Gold Backsells":1, "Station Promos":1 },
  WW:  { Liners:2, "Gold Backsells":1, "Station Promos":1 },
  WD:  { Liners:2, "Gold Backsells":1, "Station Promos":1 },
  DNa: { Liners:1, "Gold Backsells":1 },
  DNb: { Liners:1, "Gold Backsells":1 },
  GH:  { Liners:1, "Gold Backsells":2 },
  EM:  { Liners:2, "New-Music Sweepers":1, "Station Promos":1 },
};
for (const code of Object.keys(IMAGING)) IMAGING[code][`TOH ${identityOf(code)}`] = 1;

// ---------- 3. enabled depth (live census 2026-07-31) ----------
const DEPTH = {
  A1:7, A2:10, B:19, C:22, N:8, R1:22, R2:34, R3:42,
  G2010:165, G2000:150, G1990:186, H:94, Discovery:12,
  "TOH IDs":12, Liners:41, "New-Music Sweepers":44,
  "Relaunch Sweepers":12, "Gold Backsells":26, "Station Promos":14,
};

// ---------- 3b. target turnover (hours to cycle the pool once) ----------
// PROPOSAL, not derived. This is the load-bearing programming judgment of the format:
// required depth = target turnover x slots per hour. Active Rock heavy sits at 3-4h
// for the power tier; everything else ladders down from there.
const TURNOVER = {
  A1: 3.5, A2: 5, B: 8, C: 14, N: 33,   // N deliberately wide: many new tracks, ~5 plays/wk each
  R1: 24, R2: 36, R3: 48,
  G2010: 72, G2000: 96, G1990: 120, H: 150,
  Discovery: 36,
  Liners: 24, "New-Music Sweepers": 24, "Relaunch Sweepers": 24,
  "Gold Backsells": 24, "Station Promos": 24,
};
const TOH_TURNOVER = 48; // ~0.5 plays/day — below conscious recognition

const CUR = ["A1","A2","B","C","N"], REC = ["R1","R2","R3"], GOLD = ["G2010","G2000","G1990","H"];

// ---------- grid ----------
const DOW = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const cellFor = (dow, hour) => {
  const v = (dow === 0 ? SUN : dow === 6 ? SAT : WEEKDAY)[hour];
  return Array.isArray(v) ? v[(dow - 1) % v.length] : v;
};

console.log("## Weekly grid (station-local, PT)\n");
console.log("| Hr | " + DOW.join(" | ") + " |");
console.log("|---|" + DOW.map(() => "---").join("|") + "|");
for (let h = 0; h < 24; h++) {
  console.log(`| ${String(h).padStart(2,"0")} | ` + DOW.map((_, d) => cellFor(d, h)).join(" | ") + " |");
}

const hours = {};
for (let d = 0; d < 7; d++) for (let h = 0; h < 24; h++) {
  const b = cellFor(d, h);
  hours[b] = (hours[b] ?? 0) + 1;
}

console.log("\n## Block hours\n");
console.log("| Code | Block | Hours/wk | Music/hr | Cur% | Rec% | Gold% | Disc% |");
console.log("|---|---|---|---|---|---|---|---|");
for (const [code, name] of Object.entries(BLOCKS)) {
  const s = SHAPES[code];
  const sum = (keys) => keys.reduce((t, k) => t + (s[k] ?? 0), 0);
  const music = Object.values(s).reduce((a, b) => a + b, 0);
  const pct = (n) => ((n / music) * 100).toFixed(0);
  console.log(`| ${code} | ${name} | ${hours[code]} | ${music} | ${pct(sum(CUR))} | ${pct(sum(REC))} | ${pct(sum(GOLD))} | ${pct([ "Discovery"].reduce((t,k)=>t+(s[k]??0),0))} |`);
}

console.log("\n## Clock shapes — music positions per hour\n");
const allCats = [...CUR, ...REC, ...GOLD, "Discovery"];
console.log("| Block | " + allCats.join(" | ") + " | total |");
console.log("|---|" + allCats.map(() => "---").join("|") + "|---|");
for (const code of Object.keys(BLOCKS)) {
  const s = SHAPES[code];
  const row = allCats.map((c) => s[c] ?? "·");
  const tot = Object.values(s).reduce((a, b) => a + b, 0);
  console.log(`| ${code} | ${row.join(" | ")} | ${tot} |`);
}

console.log("\n## Clock shapes — imaging positions per hour\n");
const tohCats = [...new Set(Object.keys(BLOCKS).map((c) => `TOH ${identityOf(c)}`))];
const allImg = [...tohCats, "Liners","New-Music Sweepers","Relaunch Sweepers","Gold Backsells","Station Promos"];
console.log("| Block | " + allImg.join(" | ") + " | total |");
console.log("|---|" + allImg.map(() => "---").join("|") + "|---|");
for (const code of Object.keys(BLOCKS)) {
  const s = IMAGING[code];
  const tot = Object.values(s).reduce((a, b) => a + b, 0);
  console.log(`| ${code} | ${allImg.map((c) => s[c] ?? "·").join(" | ")} | ${tot} |`);
}

// ---------- demand ----------
const demand = {};
for (const code of Object.keys(BLOCKS)) {
  for (const [cat, n] of Object.entries({ ...SHAPES[code], ...IMAGING[code] })) {
    demand[cat] = (demand[cat] ?? 0) + n * hours[code];
  }
}

console.log("\n## Required depth (Phase 1c: depth = target turnover x slots/hr)\n");
console.log("| Category | Slots/wk | Target turnover | Plays/day at target | **Required depth** | Have | Delta |");
console.log("|---|---|---|---|---|---|---|");
for (const cat of [...allCats, ...allImg]) {
  const w = demand[cat] ?? 0;
  if (!w) continue;
  const target = cat.startsWith("TOH ") ? TOH_TURNOVER : TURNOVER[cat];
  const perHr = w / 168;
  const need = Math.round(target * perHr);
  const have = DEPTH[cat];
  const delta = have == null ? "*produce*" : (have - need >= 0 ? `+${have - need}` : `${have - need}`);
  console.log(
    `| ${cat} | ${w} | ${target}h | ${(24 / target).toFixed(1)} | **${need}** | ${have ?? "—"} | ${delta} |`
  );
}

const musicTotal = allCats.reduce((t, c) => t + (demand[c] ?? 0), 0);
const share = (keys) => ((keys.reduce((t, c) => t + (demand[c] ?? 0), 0) / musicTotal) * 100).toFixed(0);
console.log(`\n**Week mix:** music=${musicTotal} · currents ${share(CUR)}% · recurrents ${share(REC)}% · gold ${share(GOLD)}% · discovery ${share(["Discovery"])}%`);

console.log("\n## A1 turnover at candidate depths\n");
console.log("| A1 depth | Plays/song/day | Turnover |");
console.log("|---|---|---|");
for (const d of [7, 8, 10, 12]) {
  const perHr = demand.A1 / 168;
  console.log(`| ${d} | ${((24 * perHr) / d).toFixed(1)} | ${(d / perHr).toFixed(1)}h |`);
}

// ---------- horizontal-rotation lock check ----------
// A song's play pattern repeats every `denominator(slots_wk / depth)` weeks. An
// integer plays/wk means it lands on the same hours every week — time-of-day lock.
// ---------- depth selection by drift-per-cycle ----------
// What a habitual listener experiences is not the eventual return period but the
// DRIFT each cycle: how far the play time moves relative to a whole number of days.
//   delta = |T - 24 * round(T/24)|
// < 2h  -> successive plays land inside the same listening window. Failure.
//   3h  -> floor: clears a 2h window with margin.
// 7-11h -> target: the song crosses dayparts each cycle.
//  ~12h -> alternates between only two hours. Avoid.
// exact divisors of 24 (2,3,4,6,8) visit a handful of hours then stop. Avoid.
const DRIFT_MIN = 3, DRIFT_IDEAL = 9;
const drift = (T) => Math.abs(T - 24 * Math.round(T / 24));
const nearDivisor = (d) => [2, 3, 4, 6, 8, 12].some((k) => Math.abs(d - k) < 0.4);
const ppdOffset = (T) => { const p = 24 / T; return Math.abs(p - Math.round(p)); };

function pickDepth(cat, slots, target, taken) {
  const naive = Math.max(2, Math.round(target * (slots / 168)));
  let best = null;
  for (let d = Math.max(2, Math.floor(naive * 0.6)); d <= Math.ceil(naive * 1.6); d++) {
    const T = (168 * d) / slots;
    if (Math.abs(T - target) / target > 0.3) continue;
    let score;
    if (T < 12) {
      if (ppdOffset(T) < 0.15) continue;
      score = 20 - Math.abs(T - target) / target * 30;
    } else {
      const dl = drift(T);
      if (dl < DRIFT_MIN || nearDivisor(dl)) continue;
      score = 20 - Math.abs(dl - DRIFT_IDEAL) * 2 - Math.abs(T - target) / target * 30;
    }
    if (taken.some((t) => Math.abs(t - T) / Math.min(t, T) < 0.05)) score -= 6;
    if (!best || score > best.score) best = { d, T, score };
  }
  return best;
}

const DEPTH_TARGET = {};
const takenT = [];
for (const cat of [...CUR, ...REC, "Discovery", ...GOLD]) {
  const w = demand[cat] ?? 0;
  if (!w) continue;
  const pick = pickDepth(cat, w, TURNOVER[cat], takenT);
  if (!pick) { console.error(`!! ${cat}: no depth satisfies the drift constraint`); continue; }
  DEPTH_TARGET[cat] = pick.d;
  takenT.push(pick.T);
}

console.log("\n## Chosen depths — drift per cycle\n");
console.log("| Category | Slots/wk | **Depth** | Turnover | Plays/day | Drift per cycle | Have | Delta |");
console.log("|---|---|---|---|---|---|---|---|");
for (const cat of allCats) {
  const w = demand[cat] ?? 0, d = DEPTH_TARGET[cat];
  if (!w || !d) continue;
  const T = (168 * d) / w, ppd = 24 / T;
  const note = T < 12 ? `n/a — ${ppd.toFixed(2)}/day` : `${drift(T).toFixed(1)}h every ${(T / 24).toFixed(1)}d`;
  const have = DEPTH[cat] ?? 0;
  console.log(`| ${cat} | ${w} | **${d}** | ${T.toFixed(1)}h | ${ppd.toFixed(2)} | ${note} | ${have} | ${have - d >= 0 ? "+" : ""}${have - d} |`);
}
