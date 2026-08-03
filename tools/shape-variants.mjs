/**
 * CANDIDATE shape sets, expressed as patches against SHAPES in m4-format.mjs.
 *
 * A shape change is never only a shape change. Positions are slots, slots set turnover,
 * turnover sets depth — so every patch here has to be read twice: once for what it does
 * to the natural hour (tools/hour-length.mjs) and once for what it costs in depth and
 * lock (tools/depth-solver.mjs --variant <name>). A patch that lands the hour and breaks
 * R3's lock period has not solved anything.
 *
 * Nothing here is live. Promoting a variant means editing SHAPES in m4-format.mjs, and
 * that is a deliberate, separate act.
 */

/**
 * `allow` is the set of categories a variant may ADD positions from. It is the format
 * judgment the variant embodies, and the reason there is more than one variant: the
 * arithmetic does not care where the missing four minutes come from, and programming
 * cares about very little else.
 */
export const VARIANTS = {
  /**
   * GOLD-FUNDED. Added length comes from the gold tiers, which are already over depth
   * target (G2010 +18, G2000 +48, G1990 +32) — so it is free on sourcing, and the added
   * slots lower gold turnover toward its target rather than away from it.
   *
   * The cost is format, not arithmetic: it puts more gold into the current-heavy peak
   * clocks, moving ES/FF/HD toward the texture of the gold-heavy ones. Gold is also the
   * long-duration end of the library, so it closes the deficit in the fewest positions.
   */
  gold: {
    allow: ["G2010", "G2000", "G1990"],
    // Emitted by `hour-length.mjs --propose gold`, then read by eye. G2010 gives up a
    // position in six clocks because it is the SHORT end of gold (231s vs G1990's 249s)
    // and it is the tier furthest over depth target (+18), so the slot is both the most
    // useful to move and the cheapest to lose.
    patch: {
      ES:  { G1990: +1 },
      FF:  { G1990: +2, G2010: -1 },
      HD:  { G1990: +2, G2010: -1 },
      CO:  { G2000: +2, G2010: -1 },
      WW:  { G2010: +1 },
      WD:  { G2010: +1 },
      EM:  { G2010: +1 },
      DNa: { G2000: +1, G2010: -1, G1990: +1 },
      DNb: { G2000: +2, G2010: -1 },
      GHa: { G2010: -1, G1990: +1 },
      GHb: { G2010: -1, G1990: +1 },
    },
  },

  /**
   * FORMAT-HOLDING. Added length comes from currents and recurrents, so the peak clocks
   * keep their character. The cost is sourcing and a ladder re-solve: these are the short
   * categories, so it takes more positions to close the same deficit, and every added
   * slot raises the depth required to hold turnover.
   */
  recurrent: {
    allow: ["R1", "R2", "R3"],
    // Emitted by `hour-length.mjs --propose recurrent`. Recurrents, NOT currents: an
    // earlier pass allowed the whole currents ladder and the optimiser bought length with
    // B, taking it to 318 slots/wk — level with A1 — at which point the solver could place
    // neither N nor C beneath it and the pyramid had no solution. Length is not worth a
    // tier. Recurrents leave the currents solve untouched by construction.
    //
    // ES lands at 18 positions because with ~205s categories there is no move between +1
    // (59.4, still short) and +2 (62.4). That unevenness is the honest cost of closing a
    // 4.4 min deficit with the short end of the library.
    patch: {
      ES:  { R2: +2 },
      FF:  { R1: +1 },
      HD:  { R1: +1 },
      CO:  { R1: +2, R2: -1 },
      WW:  { R2: +1 },
      WD:  { R2: +1 },
      EM:  { R2: +1 },
      DNa: { R1: +1 },
      DNb: { R1: +1 },
    },
  },

  /**
   * AUTHOR WHAT IS ALREADY HAPPENING. F is not a neutral spacer — it is 75 tracks of
   * 2023-2025 alternative and active rock (Blink-182 "One More Time", Green Day "One Eyed
   * Bastard", Idles "Gift Horse", Ghost "Lachryma", 100 Gecs, Amyl and the Sniffers) and
   * it is airing 161 times a week, 5.3% of all airtime. The station already plays this
   * material in this quantity. It simply plays it from a pool with no depth solve, no
   * turnover target and no place in any clock.
   *
   * So the deficit does not have to be filled with a NEW era. Adding Discovery positions
   * and folding F's roster into Discovery converts an unauthored 5.3% into an authored,
   * depth-solved category of the SAME era — the station sounds identical the day it ships,
   * and the format finally describes it. Discovery is also outside the currents pyramid,
   * so it cannot repeat the B-at-318-slots failure.
   *
   * Discovery is the shortest category (3:07), so this costs the most positions. That is
   * the trade: era exposure held exactly, at the price of a longer clock.
   */
  discovery: {
    allow: ["Discovery"],
    patch: {
      ES:  { Discovery: +2 },
      FF:  { Discovery: +2 },
      HD:  { Discovery: +2 },
      CO:  { Discovery: +1 },
      WW:  { Discovery: +1 },
      WD:  { Discovery: +1 },
      EM:  { Discovery: +1 },
      DNa: { Discovery: +1 },
      DNb: { Discovery: +1 },
    },
  },
};

/** Apply a variant's patch to a shape set, returning a new one. Never mutates the input. */
export function applyVariant(shapes, name) {
  const v = VARIANTS[name];
  if (!v) throw new Error(`unknown variant "${name}" — have: ${Object.keys(VARIANTS).join(", ")}`);
  const out = {};
  for (const [code, shape] of Object.entries(shapes)) {
    out[code] = { ...shape };
    for (const [cat, delta] of Object.entries(v.patch[code] ?? {})) {
      const n = (out[code][cat] ?? 0) + delta;
      if (n < 0) throw new Error(`${name}: ${code}.${cat} would go negative`);
      if (n === 0) delete out[code][cat];
      else out[code][cat] = n;
    }
  }
  return out;
}
