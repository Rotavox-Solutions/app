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
  ES: { A1:3, A2:2, B:3, C:1, N:1, R1:1, R2:1, R3:1, G2010:2, Discovery:1 },
  FF: { A1:3, A2:2, B:2, C:1, N:1, R1:1, R2:1, R3:1, G2010:2, G2000:1, Discovery:1 },
  HD: { A1:3, A2:1, B:2, C:2, R1:1, R2:1, R3:1, G2010:2, G2000:1, G1990:1, Discovery:1 },
  CO: { A1:2, A2:1, B:2, C:1, R1:1, R2:2, R3:1, G2010:2, G2000:2, G1990:1, Discovery:1 },
  WW: { A1:2, A2:1, B:1, C:1, N:1, R1:1, R2:1, R3:2, G2010:2, G2000:1, G1990:1, H:1, Discovery:1 },
  // Wind Down is ET 20-23 / PT 17-20 — the most US-dominant music block, so Heritage
  // is sited here rather than in the Europe-heavy hours it used to lean on.
  WD: { A1:1, A2:1, B:1, C:1, R1:1, R2:1, R3:2, G2010:2, G2000:1, G1990:2, H:2, Discovery:1 },
  // European Morning: CE 08-13, UK 07-12. Morning texture — currents and G2010 forward,
  // Heritage as seasoning only (94 songs, the shallowest gold pool).
  EM: { A1:1, A2:1, B:2, C:2, R1:1, R2:1, R3:1, G2010:2, G2000:1, G1990:2, H:1, Discovery:1 },
  // G2010 held at 2 — the 20-30 demo skews to off-schedule listening, so its tier
  // must not thin out in the off-hours blocks. G2000 averages 1.5; the remaining
  // 6.5 splits between G1990 and H, the deepest and the most underused pools.
  DNa: { A1:1, C:1, R2:1, R3:1, G2010:2, G2000:2, G1990:3, H:3, Discovery:1 },
  DNb: { A1:1, C:1, R2:1, R3:1, G2010:2, G2000:1, G1990:4, H:3, Discovery:1 },
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

console.log("\n## Weekly demand vs depth\n");
console.log("| Category | Slots/wk | Enabled | Plays/song/wk | Plays/day | Turnover |");
console.log("|---|---|---|---|---|---|");
for (const cat of [...allCats, ...allImg]) {
  const w = demand[cat] ?? 0, d = DEPTH[cat];
  if (!w) continue;
  if (d == null) {
    // Depth TBD (TOH sets in production) — show what each count would yield.
    const need = (perDay) => Math.ceil(w / 7 / perDay);
    console.log(`| ${cat} | ${w} | *TBD* | — | — | ${need(1)} for 1.0/day, ${need(0.5)} for 0.5/day |`);
    continue;
  }
  const perWk = w / d, perDay = perWk / 7, turnover = (d / (w / 168));
  const flag = perDay > 5 ? " ⚠" : "";
  console.log(`| ${cat} | ${w} | ${d} | ${perWk.toFixed(1)} | ${perDay.toFixed(1)}${flag} | ${turnover.toFixed(1)}h |`);
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
