// M4 format data: block grid, clock shapes, imaging, live depths.
// Shared by tools/m4-schedule.mjs (arithmetic) and tools/rotation-sim.mjs (simulation).

// ---------- 1. block assignment per (dow, hour), station-local (PT) ----------
// dow: 0=Sun .. 6=Sat
// Deep Night alternates two variants so G2000 averages 1.5/hr; the a/b split is
// balanced to exactly 17/17 across the week (weekday 10/10, Sat 4/3, Sun 3/4).
// Deep Night is only the US-leaning trough (weekday 22, weekend 22-23). Everything
// from weekday 23:00 onward is European Morning — at 00:00 PT the block is 82% Europe
// at 09:00 local. An array value cycles its variants across the days it occurs on.
export const WEEKDAY = [
  "EM","EM","CO","CO","CO","ES","ES","ES","FF","FF","FF","FF",
  "FF","FF","HD","HD","HD","WD","WD","WD","WD","GH",["DNa","DNb"],"EM",
];
export const SAT = [
  "EM","EM","EM","EM","EM","CO","CO","CO","WW","WW","WW","WW",
  "WW","WW","WW","WW","WD","WD","WD","WD","WD","GH","DNb","DNa",
];
export const SUN = [
  "EM","EM","EM","EM","EM","CO","CO","CO","WW","WW","WW","WW",
  "WW","WW","WW","WW","WD","WD","WD","WD","WD","GH","DNb","DNa",
];

export const BLOCKS = {
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
export const IDENTITY = { DNa: "DN", DNb: "DN" };
export const identityOf = (code) => IDENTITY[code] ?? code;

// ---------- 2. clock shapes: category -> positions per hour ----------
export const SHAPES = {
  // N (new music) is carried in every music block except Golden Hour, and doubled in
  // the two peak blocks. Positions came out of gold — a deliberate trade of gold
  // plays for new-music exposure, per PD direction 2026-08-01.
  ES: { A1:3, A2:3, B:2, C:1, N:2, R1:1, R2:1, R3:1, G2010:1, Discovery:1 },
  FF: { A1:3, A2:2, B:2, C:1, N:2, R1:1, R2:1, R3:1, G2010:2, Discovery:1 },
  HD: { A1:3, A2:2, B:1, C:2, N:1, R1:1, R2:1, R3:1, G2010:2, G2000:1, Discovery:1 },
  CO: { A1:2, A2:2, B:1, C:1, N:1, R1:1, R2:2, R3:1, G2010:2, G2000:1, G1990:1, Discovery:1 },
  WW: { A1:2, A2:1, B:1, C:1, N:1, R1:1, R2:1, R3:2, G2010:2, G2000:1, G1990:2, Discovery:1 },
  // Wind Down is ET 20-23 / PT 17-20 — the most US-dominant music block, so Heritage
  // is sited here rather than in the Europe-heavy hours it used to lean on.
  WD: { A1:1, A2:1, B:1, C:1, N:1, R1:1, R2:1, R3:2, G2010:2, G2000:1, G1990:2, H:1, Discovery:1 },
  // European Morning: CE 08-13, UK 07-12. Morning texture, Heritage as seasoning only.
  EM: { A1:1, A2:1, B:2, C:2, N:1, R1:1, R2:1, R3:1, G2010:2, G2000:2, G1990:1, Discovery:1 },
  // G2010 held at 2 — the 20-30 demo skews to off-schedule listening.
  DNa: { A1:1, C:1, N:1, R2:1, R3:1, G2010:2, G2000:2, G1990:3, H:2, Discovery:1 },
  DNb: { A1:1, C:1, N:1, R2:1, R3:1, G2010:2, G2000:1, G1990:4, H:2, Discovery:1 },
  GH:  { G2010:2, G2000:2, G1990:6, H:4, Discovery:1 },
};

// TOH IDs are per-block categories (one identity per block), so the top of the hour
// reflects what the station is at that moment. `TOH *` depths are TBD — being produced.
export const IMAGING = {
  ES:  { Liners:4, "New-Music Sweepers":1, "Relaunch Sweepers":1, "Station Promos":1 },
  FF:  { Liners:4, "New-Music Sweepers":1, "Gold Backsells":1, "Station Promos":1 },
  HD:  { Liners:4, "New-Music Sweepers":1, "Relaunch Sweepers":1, "Station Promos":1 },
  CO:  { Liners:3, "Gold Backsells":1, "Station Promos":1 },
  WW:  { Liners:3, "Gold Backsells":1, "Station Promos":1 },
  WD:  { Liners:3, "Gold Backsells":1, "Station Promos":1 },
  DNa: { Liners:1, "Gold Backsells":1 },
  DNb: { Liners:1, "Gold Backsells":1 },
  GH:  { Liners:1, "Gold Backsells":2 },
  EM:  { Liners:3, "New-Music Sweepers":1, "Station Promos":1 },
};
for (const code of Object.keys(IMAGING)) IMAGING[code][`TOH ${identityOf(code)}`] = 1;

// ---------- 3a. TARGET depth: turnover x drift x freshness, jointly ----------
// Three constraints, reconciled rather than traded off:
//   turnover  — the programming standard (§0a format definition)
//   drift     — turnover must sit >=5h from any whole-day multiple, or a song creeps
//               back into the same listening window night after night
//   freshness — simulated: share of weeks a listener in a fixed slot hears a DIFFERENT
//               song. Depends on depth-vs-slot-pattern resonance, NOT on turnover, and
//               is not monotonic: R2 at 42 scores 25%, at 43 it scores 100%.
// Turnover deviation is penalised, so each depth is the freshest value near its target
// rather than the freshest value outright.
export const DEPTH_TARGET = {
  // Currents are sized turnover-FIRST, then checked against cume repeat within
  // tolerance — the PD's stated priority order. An earlier pass let freshness drive
  // depth and produced a broken ladder: A1 at 5.05 plays/day then a cliff to A2 at
  // 2.16 and a flat plateau below, which is a power tier with three light tiers under
  // it rather than an Alternative CHR currents ladder.
  // Depth must WIDEN as the ladder descends — a power tier is narrow and hot, lower
  // tiers wide and light. An earlier pass produced A2 (8) shallower than A1 (10),
  // which is inverted. The cause was upstream: the clock shapes gave B more weekly
  // slots than A2, so A2 could not be both deeper and lighter than B. Fixed in
  // SHAPES (ES/HD/CO), giving slots A1 318 > A2 248 > B 222 > N 206 > C 201.
  //   depth   10 < 13 < 14 < 16 < 20
  //   plays/day 4.54 > 2.73 > 2.27 > 1.79 > 1.47
  A1: 10, A2: 13, B: 14, C: 16, N: 20,
  R1: 29, R2: 43, R3: 70, Discovery: 29,
  G2010: 155, G2000: 99, G1990: 163, H: 70,
};

/**
 * Typical weeks a song spends in each category. Currents split the 20-week Mediabase
 * currents window across tiers; recurrents and gold from "months to years". These are
 * ASSUMPTIONS except the 20-week total, which is sourced.
 *
 * Residency is the correct horizon for measuring freshness: a metric run over 26 weeks
 * on a pool that turns over in 6 is measuring a world that does not exist. It also
 * determines whether relock matters — arithmetic relock needs the same set of songs
 * week over week, so a short-residency pool is largely immune while gold is not.
 */
export const RESIDENCY_WEEKS = {
  A1: 6, A2: 8, B: 12, C: 20, N: 5,
  R1: 26, R2: 52, R3: 104, Discovery: 12,
  G2010: 520, G2000: 520, G1990: 520, H: 520,
};

/**
 * Horizontal separation parameters, currents only. Recurrents and gold reach ~0%
 * week-to-week repeat passively, and applying the rule there subtracts (see
 * tools/rule-sim.mjs). C needs none.
 */
export const HORIZONTAL = {
  A1: { windowHours: 1, minDays: 4 },
  A2: { windowHours: 1, minDays: 1 },
  B: { windowHours: 1, minDays: 10 },
  C: { windowHours: 1, minDays: 1 },
  N: { windowHours: 1, minDays: 1 },
};

// ---------- 3. enabled depth (live census 2026-07-31) ----------
export const DEPTH = {
  A1:7, A2:10, B:19, C:22, N:8, R1:22, R2:34, R3:42,
  G2010:165, G2000:150, G1990:186, H:94, Discovery:12,
  "TOH IDs":12, Liners:41, "New-Music Sweepers":44,
  "Relaunch Sweepers":12, "Gold Backsells":26, "Station Promos":14,
};

// ---------- 3b. target turnover (hours to cycle the pool once) ----------
// PROPOSAL, not derived. This is the load-bearing programming judgment of the format:
// required depth = target turnover x slots per hour. Active Rock heavy sits at 3-4h
// for the power tier; everything else ladders down from there.
export const TURNOVER = {
  // Standards-based ladder for Alternative CHR ("New Rock"). Every value avoids the
  // divisors of 24 (1,2,3,4,6,8,12,24) and sits >=5h from any whole-day multiple, per
  // the scheduling convention that even turnovers pin a song to the same clock times.
  A1: 5, A2: 7, B: 11, N: 13, C: 15,
  R1: 31, Discovery: 35, R2: 39, R3: 57,
  G2010: 81, G2000: 105, G1990: 129, H: 153,
  Liners: 23, "New-Music Sweepers": 23, "Relaunch Sweepers": 23,
  "Gold Backsells": 23, "Station Promos": 23,
};
export const TOH_TURNOVER = 47; // ~0.5 plays/day — below conscious recognition

export const CUR = ["A1","A2","B","C","N"], REC = ["R1","R2","R3"], GOLD = ["G2010","G2000","G1990","H"];
export const DOW = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
export function cellFor(dow, hour) {
  const v = (dow === 0 ? SUN : dow === 6 ? SAT : WEEKDAY)[hour];
  return Array.isArray(v) ? v[(dow - 1) % v.length] : v;
}
/** Every music slot in a week, in air order: {dow, hour, cat}. */
export function weekSlots() {
  const out = [];
  for (let dow = 0; dow < 7; dow++) for (let hour = 0; hour < 24; hour++) {
    const shape = SHAPES[cellFor(dow, hour)];
    for (const [cat, n] of Object.entries(shape)) for (let i = 0; i < n; i++) out.push({ dow, hour, cat });
  }
  return out;
}
