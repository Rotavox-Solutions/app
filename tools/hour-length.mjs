/**
 * What does an hour of each clock ACTUALLY run, before filler?
 *
 * WHY THIS EXISTS
 * ---------------
 * The clocks were authored on an assumed ~3:30 song. The library does not have one. Live
 * means split cleanly by era:
 *
 *   currents / recurrents   A1 194s ... N 215s      (~3:15-3:35)
 *   gold / heritage         G2000 231s ... H2 252s  (~3:50-4:12)
 *
 * So a clock's natural length is a function of its currents share, and the current-heavy
 * peak clocks are the short ones. ES (11 of 16 positions in currents) runs 55.6 min;
 * Golden Hour (zero currents) runs 60.2 and needs no help at all. That is a structural
 * property of the shape, not a scheduling accident, and no amount of filler fixes it —
 * filler only hides it. If F appears in nearly every hour then F is not filler, it is an
 * unauthored position, and the hour it pads is under-authored.
 *
 * This tool measures the natural hour so shape changes are costed against real durations
 * rather than an assumed song length. It is the length half of the picture; the depth
 * half is tools/depth-solver.mjs, and a shape change must be read in both — added slots
 * lower turnover, which is paid for in depth or in a broken lock.
 *
 * READ-ONLY. Live means come from the Scheduler's Postgres; nothing is written.
 *
 *   node tools/hour-length.mjs                    # natural length, current shapes
 *   node tools/hour-length.mjs --variant gold     # ...under a candidate shape set
 *   node tools/hour-length.mjs --search gold      # propose shapes that land in band
 *
 * Requires DATABASE_URL (packages/schema/.env):
 *   set -a; . packages/schema/.env; set +a; node tools/hour-length.mjs
 */
import postgres from "postgres";
import { SHAPES, IMAGING, FILLER_SLOTS, cellFor, CUR } from "./m4-format.mjs";
import { VARIANTS, applyVariant } from "./shape-variants.mjs";

/**
 * The band a clock's natural hour should land in, in minutes.
 *
 * Deliberately ABOVE 60. Per PERFECT-HOUR.md the asymmetry is the whole argument: an
 * underscheduled hour is dead air and unrecoverable, an overscheduled one is a shear and
 * bounded. Authoring to exactly 60.0 puts the mean draw under 60 half the time, which
 * calls filler in half the hours — the condition we are trying to leave. Authoring to
 * ~60.8 makes the trim the normal mechanism (ranked and cheap, per trimPriority) and
 * returns F to what it is named for: covering a genuinely short draw.
 */
export const BAND = [60.3, 61.3];
const AIM = (BAND[0] + BAND[1]) / 2;

const argOf = (n) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };

const sql = postgres(process.env.DATABASE_URL, { max: 1 });

/** Mean and spread of duration per category, enabled songs only, cue-aware where known. */
async function liveMeans() {
  const rows = await sql`
    select c.name as cat,
           count(*)::int as n,
           avg(coalesce(s.effective_duration_ms, s.duration_ms)) / 1000.0 as secs,
           coalesce(stddev_samp(coalesce(s.effective_duration_ms, s.duration_ms)), 0) / 1000.0 as sd
    from categories c
    join song_categories sc on sc.category_id = c.id
    join songs s on s.id = sc.song_id and s.enabled
    where coalesce(s.effective_duration_ms, s.duration_ms) > 0
    group by c.name`;
  const mean = {}, count = {}, sd = {};
  for (const r of rows) { mean[r.cat] = Number(r.secs); count[r.cat] = r.n; sd[r.cat] = Number(r.sd); }
  return { mean, count, sd };
}

/** Normal CDF, Abramowitz & Stegun 26.2.17. Good to ~7e-8 — far tighter than the model. */
function phi(z) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989422804014327 * Math.exp((-z * z) / 2);
  const p = d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return z > 0 ? 1 - p : p;
}

/**
 * How often will this clock come up short — i.e. how often must F fire?
 *
 * An hour is a sum of ~16 independent draws, so its length is approximately normal about
 * the natural mean with variance the sum of the per-category variances. P(hour < 60) is
 * then the share of hours in which the authored positions cannot fill the clock and
 * filler is structurally required.
 *
 * This, not "is the mean 60", is the test of whether F is filler. A clock whose mean is
 * exactly 60.0 comes up short in half its hours; F would appear in every other log and
 * would have stopped being filler long before anyone noticed the mean looked correct.
 *
 * Draws are without replacement within an hour and categories repeat inside a clock, so
 * the true variance is slightly lower than this. The bias is conservative — it overstates
 * how often F fires — and is small next to the spread of the library itself.
 */
function shortProbability(code, shapes, mean, sd) {
  const { secs } = naturalSeconds(code, shapes, mean);
  let varSum = 0;
  for (const [cat, n] of Object.entries(shapes[code] ?? {})) varSum += n * (sd[cat] ?? 0) ** 2;
  for (const [cat, n] of Object.entries(IMAGING[code] ?? {})) varSum += n * (sd[cat] ?? 0) ** 2;
  const s = Math.sqrt(varSum);
  return { p: s > 0 ? phi((3600 - secs) / s) : secs < 3600 ? 1 : 0, sd: s / 60 };
}

/** Standard normal density. */
const npdf = (z) => 0.3989422804014327 * Math.exp((-z * z) / 2);

/**
 * Expected NUMBER of F items an hour will activate — not just whether it activates one.
 *
 * P(short) says how often filler fires; this says how much. They diverge exactly where it
 * matters: a clock 4.4 min short does not call one F, it calls two, and the second is
 * indistinguishable from an authored position to everyone except the person who authored
 * the clock.
 *
 * Shortfall S = 3600 - hourLength is normal with mean (3600 - natural) and the hour's SD,
 * and filler covers max(0, S). For X ~ N(m, s), E[max(0,X)] = m*Phi(m/s) + s*phi(m/s).
 * Divide by the mean F to get items.
 *
 * This is the load-bearing number for era exposure. F is a real pool with a real era; if
 * it fires often enough it is a category, and it is a category nobody put in the clock.
 */
function expectedFillerCount(code, shapes, mean, sd) {
  const { secs } = naturalSeconds(code, shapes, mean);
  let varSum = 0;
  for (const [cat, n] of Object.entries(shapes[code] ?? {})) varSum += n * (sd[cat] ?? 0) ** 2;
  for (const [cat, n] of Object.entries(IMAGING[code] ?? {})) varSum += n * (sd[cat] ?? 0) ** 2;
  const s = Math.sqrt(varSum);
  const m = 3600 - secs;
  if (s <= 0) return Math.max(0, m) / (mean.F ?? 198);
  const expShortfall = m * phi(m / s) + s * npdf(m / s);
  return expShortfall / (mean.F ?? 198);
}

/** Natural seconds for one clock: every authored position at its category's mean. F excluded. */
export function naturalSeconds(code, shapes, mean) {
  let s = 0;
  const missing = [];
  for (const [cat, n] of Object.entries(shapes[code] ?? {})) {
    if (mean[cat] == null) { missing.push(cat); continue; }
    s += mean[cat] * n;
  }
  for (const [cat, n] of Object.entries(IMAGING[code] ?? {})) {
    // Imaging that has not been produced yet contributes nothing and must not be counted
    // as if it had — an unproduced TOH is silence, and silence is the failure mode.
    if (mean[cat] == null) { missing.push(cat); continue; }
    s += mean[cat] * n;
  }
  return { secs: s, missing };
}

const musicPositions = (code, shapes) => Object.values(shapes[code] ?? {}).reduce((a, b) => a + b, 0);

function report(shapes, mean, sd, label, hoursPerWeek) {
  console.log(`\n## Natural hour — ${label}\n`);
  console.log("| clock | music pos | natural | vs 60:00 | hour SD | P(short) → F fires |");
  console.log("|---|---|---|---|---|---|");
  const missingAll = new Set();
  let weighted = 0, hours = 0;
  for (const code of Object.keys(shapes)) {
    const { secs, missing } = naturalSeconds(code, shapes, mean);
    missing.forEach((m) => missingAll.add(m));
    const m = secs / 60;
    const d = m - 60;
    const { p, sd: hsd } = shortProbability(code, shapes, mean, sd);
    const hw = hoursPerWeek[code] ?? 0;
    weighted += p * hw; hours += hw;
    console.log(
      `| ${code} | ${musicPositions(code, shapes)} | ${m.toFixed(2)} | ${d >= 0 ? "+" : ""}${d.toFixed(2)} | ` +
        `${hsd.toFixed(2)} | ${(p * 100).toFixed(0)}% |`
    );
  }
  console.log(`\n**Station-wide, weighted by hours aired: F fires in ${((weighted / hours) * 100).toFixed(0)}% of hours** (${(weighted).toFixed(1)} of ${hours} hours/week)`);
  if (missingAll.size) {
    console.log(`\n! no live duration for: ${[...missingAll].join(", ")} — counted as zero, so these hours read SHORTER than they will air once produced.`);
  }
  return weighted / hours;
}

/**
 * Propose shape edits that land a clock in band, drawing added positions only from
 * `allow`. Swaps move one unit between categories and are free on total slot count —
 * they buy length without lowering anyone's turnover, so they are searched first.
 *
 * FLOOR RULE: no category authored into a clock may be reduced below 1. A category that
 * appears once per clock is at its exposure floor already; taking it to zero leaves whole
 * hours with no instance of it, which is a format change masquerading as arithmetic.
 * (PD direction 2026-08-03, raised for Discovery, which sits at 1 in every daytime clock.)
 */
function search(code, shapes, mean, allow) {
  const base = shapes[code];
  const cats = Object.keys(base);
  const cands = [];
  const push = (shape, desc) => {
    const s = naturalSeconds(code, { [code]: shape }, mean).secs / 60;
    cands.push({ m: s, desc, err: Math.abs(s - AIM), adds: musicPositions(code, { [code]: shape }) - musicPositions(code, shapes) });
  };

  for (let k = 0; k <= 2; k++) {
    const addSets = k === 0 ? [[]] : k === 1 ? allow.map((a) => [a]) : allow.flatMap((a) => allow.map((b) => [a, b]));
    for (const adds of addSets) {
      const withAdds = { ...base };
      for (const a of adds) withAdds[a] = (withAdds[a] ?? 0) + 1;
      push(withAdds, adds.length ? `+${adds.join(" +")}` : "no change");
      // one optional swap on top, from a category above its floor into a longer one
      for (const from of cats) {
        if (withAdds[from] <= 1) continue;
        // Currents are never a source of length. Trading an A1 out of a peak clock buys
        // 55 seconds and costs a third of that hour's power rotation — a format decision,
        // and not one arithmetic gets to make on its own. The optimiser will reach for it
        // every time otherwise, because it is the cheapest move on the objective and the
        // objective knows nothing about what a peak hour is for.
        if (CUR.includes(from)) continue;
        for (const to of allow) {
          if (to === from || mean[to] <= mean[from]) continue;
          const sw = { ...withAdds, [from]: withAdds[from] - 1, [to]: (withAdds[to] ?? 0) + 1 };
          push(sw, `${adds.length ? `+${adds.join(" +")}, ` : ""}swap ${from}->${to}`);
        }
      }
    }
  }
  cands.sort((a, b) => a.err - b.err || a.adds - b.adds || a.desc.length - b.desc.length);
  return cands.slice(0, 6);
}

/**
 * Best single edit per clock, as a patch literal ready to paste into shape-variants.mjs.
 *
 * "Best" is nearest the aim point, tie-broken toward fewer added positions — an added
 * position is paid for in depth, a swap is not. Clocks already within band are left
 * alone; the aim is the shortest edit that stops the hour being structurally short, not
 * a uniform rewrite.
 */
function propose(shapes, mean, sd, allow) {
  const patch = {};
  for (const code of Object.keys(shapes)) {
    const now = naturalSeconds(code, shapes, mean).secs / 60;
    if (now >= BAND[0] && now <= BAND[1]) continue;
    const best = search(code, shapes, mean, allow)[0];
    if (!best || best.desc === "no change") continue;
    const delta = {};
    for (const part of best.desc.split(", ")) {
      if (part.startsWith("+")) for (const a of part.slice(1).split(" +")) delta[a] = (delta[a] ?? 0) + 1;
      else if (part.startsWith("swap ")) {
        const [from, to] = part.slice(5).split("->");
        delta[from] = (delta[from] ?? 0) - 1;
        delta[to] = (delta[to] ?? 0) + 1;
      }
    }
    patch[code] = delta;
  }
  return patch;
}

const { mean, count, sd } = await liveMeans();

/** How many hours a week each clock actually airs — the weight for any station-wide figure. */
const hoursPerWeek = {};
for (let dow = 0; dow < 7; dow++) for (let hour = 0; hour < 24; hour++) {
  const code = cellFor(dow, hour, 0);
  hoursPerWeek[code] = (hoursPerWeek[code] ?? 0) + 1;
}

console.log("## Live category means (enabled, cue-aware)\n");
console.log("| category | n | mean |");
console.log("|---|---|---|");
for (const [cat, s] of Object.entries(mean).sort((a, b) => a[1] - b[1])) {
  if (s < 60) continue; // imaging; reported separately below
  console.log(`| ${cat} | ${count[cat]} | ${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")} |`);
}

const variant = argOf("variant");
const shapes = variant ? applyVariant(SHAPES, variant) : SHAPES;
report(shapes, mean, sd, variant ? `variant "${variant}"` : "current SHAPES", hoursPerWeek);
eraShare(shapes, mean, sd, hoursPerWeek, variant ? `variant "${variant}"` : "current SHAPES");

const searchFor = argOf("search");
if (searchFor) {
  const allow = VARIANTS[searchFor]?.allow;
  if (!allow) { console.error(`unknown variant "${searchFor}" — have: ${Object.keys(VARIANTS).join(", ")}`); process.exit(1); }
  console.log(`\n## Candidate shapes — adding only from [${allow.join(", ")}], target ${AIM.toFixed(1)} min\n`);
  for (const code of Object.keys(SHAPES)) {
    const hits = search(code, SHAPES, mean, allow);
    const now = naturalSeconds(code, SHAPES, mean).secs / 60;
    if (now >= BAND[0] && now <= BAND[1]) { console.log(`### ${code} — already in band at ${now.toFixed(2)}, leave alone\n`); continue; }
    console.log(`### ${code} — ${now.toFixed(2)} now`);
    if (!hits.length) { console.log("  no candidate lands in band\n"); continue; }
    for (const h of hits) console.log(`  ${h.m.toFixed(2)}  ${h.adds >= 0 ? "+" : ""}${h.adds} pos  ${h.desc}`);
    console.log();
  }
}

/**
 * ERA EXPOSURE — the share of airtime, by tier, that a listener actually hears.
 *
 * Reported by MINUTES, not by positions. A gold position is 3:51-4:12 and a currents
 * position is 3:07-3:38, so counting slots understates gold by roughly a fifth of itself.
 * The listener experiences time.
 *
 * F is counted at its MODELLED rate and in its OWN era, which is the point of this report.
 * F is a current-era pool -- 2023-2025 alternative and active rock -- so every hour it
 * fills has been quietly propping up the currents share. Any change that reduces F while
 * adding gold moves era exposure twice, and only one of those moves is visible in SHAPES.
 */
function eraShare(shapes, mean, sd, hoursPerWeek, label) {
  const TIER = { currents: CUR, recurrents: ["R1", "R2", "R3"], discovery: ["Discovery"], gold: ["G2010", "G2000", "G1990"], heritage: ["H1", "H2"] };
  const tierOf = (cat) => Object.entries(TIER).find(([, cs]) => cs.includes(cat))?.[0];
  const secs = { currents: 0, recurrents: 0, discovery: 0, gold: 0, heritage: 0, filler: 0 };
  let fillerItems = 0;
  for (const code of Object.keys(shapes)) {
    const hw = hoursPerWeek[code] ?? 0;
    for (const [cat, n] of Object.entries(shapes[code])) {
      const t = tierOf(cat);
      if (t) secs[t] += n * (mean[cat] ?? 0) * hw;
    }
    const f = expectedFillerCount(code, shapes, mean, sd);
    fillerItems += f * hw;
    secs.filler += f * (mean.F ?? 198) * hw;
  }
  const total = Object.values(secs).reduce((a, b) => a + b, 0);
  console.log(`\n### Era exposure — ${label}\n`);
  console.log("| tier | min/week | share |");
  console.log("|---|---|---|");
  for (const [t, v] of Object.entries(secs)) {
    console.log(`| ${t}${t === "filler" ? " (F, current-era)" : ""} | ${(v / 60).toFixed(0)} | ${((v / total) * 100).toFixed(1)}% |`);
  }
  const modern = secs.currents + secs.filler;
  console.log(`\n current-era total (currents + F): **${((modern / total) * 100).toFixed(1)}%**` +
    ` · gold+heritage: **${(((secs.gold + secs.heritage) / total) * 100).toFixed(1)}%**` +
    ` · F items/week: **${fillerItems.toFixed(0)}** (${(fillerItems / 168).toFixed(2)}/hour)`);
  return { modernShare: modern / total, fillerItems };
}

const proposeFor = argOf("propose");
if (proposeFor) {
  const allow = VARIANTS[proposeFor]?.allow;
  if (!allow) { console.error(`unknown variant "${proposeFor}"`); process.exit(1); }
  const patch = propose(SHAPES, mean, sd, allow);
  console.log(`\n## Proposed patch for variant "${proposeFor}"\n`);
  console.log("  patch: " + JSON.stringify(patch, null, 4).replace(/\n/g, "\n  ") + ",");
  const proposed = { ...SHAPES, ...Object.fromEntries(Object.entries(patch).map(([c, d]) => {
    const s = { ...SHAPES[c] };
    for (const [k, v] of Object.entries(d)) { const n = (s[k] ?? 0) + v; if (n <= 0) delete s[k]; else s[k] = n; }
    return [c, s];
  })) };
  report(proposed, mean, sd, `variant "${proposeFor}" (proposed)`, hoursPerWeek);
  eraShare(proposed, mean, sd, hoursPerWeek, `variant "${proposeFor}" (proposed)`);
}

// F is sized to the residual, not to the deficit. Report what the current sizing implies.
const totalF = Object.values(FILLER_SLOTS).reduce((a, b) => a + b, 0);
console.log(`\nF candidates authored across ${Object.keys(FILLER_SLOTS).length} clocks: ${totalF} (mean F ${(mean.F ?? 0).toFixed(0)}s)`);

await sql.end();
