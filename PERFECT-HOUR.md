# The Perfect 60-Minute Hour

- **Status:** design note · **Date:** 2026-08-02
- **Extends:** `ADR-0001` §3.3 (writeback as adapter capability), §3.5c (adapter tiers)
- **Implemented today:** rungs 1–2. Rungs 3–4 are proposals.

---

## 1. The claim

**Rotavox produces the perfect 60-minute hour.** Content ends at `:00:00.000` — no dead
air, no incidental shear, no drift carried forward.

It is a stronger claim than competitors can make, and unusually for scheduling software it
is **demonstrable**: a log of realised hour lengths is a one-column proof.

### Why it is achievable at all

Because **playout deviation is missing data, not inherent uncertainty.** With RadioDJ's
cue points (`sta`/`xta`) known, the log's arithmetic *is* the playout arithmetic. The
next track begins at `xta`; there is no unmodelled physics between schedule and air.

The residual is **granularity**, not fuzziness: songs are atomic, so an hour lands one
song over or one song under. That is what the filler mechanism resolves.

Where cue data is absent the claim weakens honestly and measurably — `cueFidelity` is
reported on every generation, and a station whose adapter cannot expose segue points is
simply running at lower fidelity. **This is a tier property, not a limitation to hide.**

---

## 2. The escalation ladder

Corrections apply in order of invasiveness. Escalate only when the rung above cannot
close the gap. Most hours never pass rung 2.

| # | Mechanism | Audio changed? | Consent needed? | Status |
|---|---|---|---|---|
| 1 | **Structural: filler activation** | no | no | **shipped** |
| 2 | **Structural: ranked sacrifice** | no | no | **shipped** |
| 3 | **Cue-point tightening** | yes, bounded | **yes** | proposed |
| 4 | **Playout rate variance** | yes | yes | adapter-dependent |

### Rung 1–2 — structural (shipped 2026-08-02)

An hour is **always deliberately overscheduled**, because the costs are asymmetric:
underscheduling risks dead air, which is unrecoverable; overscheduling costs a shear,
which is bounded. So the optimum is never "target 60:00 exactly" — it is 60:00 plus the
smallest strictly-positive margin, which is one item.

- **Filler candidates** are pre-placed at van der Corput positions and ranked. The
  generator activates as many as the hour's deficit requires (`ceil`, never `round`).
- **Priority-1 filler is the tail**, doubling as the **shear buffer** — so any residual
  shear lands on an F by construction rather than on programmed content.
- **Ranked sacrifice** gives up positions in `trimPriority` order when an hour cannot fit
  its budget: deepest gold first, Discovery last of the sacrificeable pools, currents and
  imaging never.
- **Drift is carried** (`carryMs`), capped at 5 minutes. An overrun becomes the next
  hour's reduced budget; the boundary never moves. Underruns bank no credit.
  **Superseded in part — see §5b:** "no credit" is `maxEarlyDriftMs = 0`, which makes a
  zero average drift unreachable. The bound is now 30s.

**Shears are not failures — they are the release valve that protects the rest of the
hour.** The metric that matters is *what* was shorn, never *whether* anything was.

### Rung 3 — cue-point tightening (proposed)

Where the residual is small enough to close by trimming a few seconds across an hour,
Rotavox adjusts `xta` to shorten effective duration. `songs.cue_times` is a MariaDB
column already read on every sync; writing it is the same mechanism as a changeset.

**Required bounds — this is an editorial act, not arithmetic.** Pulling `xta` earlier cuts
into the outro. Done blindly it clips a vocal tail or a final chord and the station sounds
hacked.

- Never trim past a detected **vocal end**. `tools/analyze-library.py` can supply this;
  without that analysis, rung 3 is not available.
- Cap per-track trim (a second or two), and cap the number of tracks touched per hour.
- **Reversible.** Original cue points recorded so the change inverts, like any changeset.
- **Opt-in per station.** Some PDs will refuse Rotavox any authority over how records
  sound, and that is a legitimate position — it simply caps them at rung 2.

### Rung 4 — playout rate variance (adapter-dependent)

±1% is inaudible on music and worth ~36 seconds an hour; ±2% is ~72 seconds and audible
to some ears on sustained material.

**Not available on RadioDJ.** A live capability probe of the rig confirms six REST
commands — `ClearPlaylist`, `EnableAutoDJ`, `LoadTrackToBottom`, `LoadTrackToTop`,
`RemovePlaylistTrack`, `StatusQueue`. No rate, pitch, fade or volume control exists to
address.

It may be reachable on other playout systems, and should be treated as a **per-adapter
capability probed at runtime** (invariant #1), never assumed. Where present it is the
finest-grained instrument available and should still be the last rung, because it alters
every second of a record rather than a bounded region of it.

---

## 3. Explicitly rejected: duration-aware song selection

Scoring candidates on how well their length closes the hour looks free — no audio
modification, no consent, no new capability. **It is not free, and it is the wrong kind
of solution.**

1. **It corrupts turnover, persistently.** A 3:14 record closes gaps better than a 4:02
   record, so it is selected more often — forever, for a reason with no musical content.
   Depth targets exist to give every song in a pool equal exposure; a length bias breaks
   that silently and invalidates the drift and lock properties depth was solved for.
2. **The constraint always binds.** With 187 songs in G1990 there is always *something* at
   any required length, so this is never a tiebreak between near-equals — it is a
   permanent thumb on the scale, applied without regard to suitability against surrounding
   material or clock position.
3. **It is the same error as padding from a scheduled category**, which was rejected on
   2026-08-02 for perturbing G2010's turnover by 45%. Selection bias is that error moved
   inside the pool, where it is harder to see.
4. **It is unnecessary.** Rungs 1–2 already land the hour structurally. Selection would
   only reduce how often F appears — a cosmetic gain paid for with rotation integrity.

**One narrow exception:** choosing *which* F to activate. There, duration is the job.
Selecting filler by fit is legitimate precisely because the slot exists to fill time.

---

## 4. Pre-flight massage is the creative surface

The perfect hour is achieved **pre-flight, deliberately** — never in-flight, incidentally.

Everything resolved at generation is visible in the log the PD approves, and therefore
editable: swap one F for another to suit the vibe, override an F with a Gx/Rx/N, promote
an N into the gap, or decide this particular hour is better at 57 minutes.

**A cold algorithm cannot weigh what a PD weighs.** Guest appearances, a record breaking
elsewhere that week, a lyric that lands badly against the news, a segue that only works
because of what preceded it — none of it is in the calculus. An algorithm that optimises
its way to a perfect hour without leaving that surface intact has produced arithmetic,
not radio.

So the design rule: **the algorithm's job is to make every hour land at 60:00 while
leaving the maximum number of decisions still open.** Filler is pre-placed but
overridable; sacrifice is ranked but visible; nothing resolves at playout that could have
resolved at generation.

This is also why `pickFillerItem` in the pacer changes role rather than disappearing. It
is no longer the mechanism — it is the backstop for when generation was wrong. **If it
fires at all, that is a generation miss worth investigating**, not routine operation.

---

## 5. Market position

Worth stating plainly because it shapes priority: **this claim is worth far more to
terrestrial stations than to internet-only ones.**

Hard top-of-hour is a real operational constraint for network joins, syndicated content
and legal station IDs. An internet station running 40 seconds long has a cosmetic problem.
A licensed terrestrial station missing a network join has an actual one.

"The Perfect 60-Minute Hour" is therefore a **wedge into the terrestrial market** — which
is the larger one — for a product otherwise positioned around internet radio. It is also
the rare scheduling claim a prospect can verify in a single screenshot.

---

## 5a. In-flight filler selection: longest-that-fits — FOR REVIEW

- **Status:** proposed, not adopted · **Raised:** 2026-08-20 · **Decide before:** any pacer change lands

§4 says in-flight filler is the backstop, and that its firing at all is a generation
miss. Forensics on 2026-08-18/19 found it firing at the top of nearly every hour after
a takeover and injecting a whole record each time, so the selection rule itself now
needs a decision on the record.

**Proposed rule.** Bound the choice by the time left before the ID is due, measured
from where committed audio ends rather than from `now`, and take the LONGEST item that
fits. Imaging is eligible, not just music. If nothing fits, decline and leave the gap
to the ID rather than overrun the boundary.

**Why longest-first.** A gap should close in as few elements as possible. Shortest-first
fills a four-minute hole with a chain of liners, which sounds like a fault even though
the arithmetic is right.

**Why this does not contradict §3.** §3 rejects duration-aware selection for SCHEDULED
positions because it corrupts turnover permanently. Filler is the stated exception:
the slot exists to fill time, so length is the job, not a thumb on the scale. The
distinction is worth re-reading before extending fit-based choice anywhere else.

### Measured 2026-08-20 — the numbers that decide it

**Every hour is overscheduled. Not most — every one.** Across 48 consecutive scheduled
hours, the projected end of the last item versus the next ID's due instant:

| hours | min | p50 | p90 | p95 | max | short | over |
|---|---|---|---|---|---|---|---|
| 48 | −236s | −117s | −26s | −19s | −1s | **0** | **48** |

Negative is surplus. There was no underrun to bridge in any hour of the sample, which
settles the premise: **RF is strictly a guard**, and every fire observed on air was a
false positive.

**Why it fired anyway.** `FILLER_DEPTH_FLOOR = 1` counts ITEMS. When the pacer reaches
the gated ID it stops pushing and the queue drains 3 → 2 → 1. At depth 1 the guard fires
— but that one remaining item is routinely a 3-minute song. It bridges a hole that does
not exist, and does so with a full record.

**The inventory is bimodal, which constrains any fix.** Nothing exists between roughly
15s and 169s:

| band | inventory |
|---|---|
| ≤ 15s | 135 imaging elements (sweepers, liners, backsells, IDs) |
| 15–60s | 11 station promos, 2 stray music |
| 60–169s | **essentially nothing** |
| ≥ 169s | all music — **F included** |

**F is not short-form.** 75 songs, 169s min, 194s median, 271s max. F is a current-era
music pool, so "have RF draw from F" cannot close a small gap — the floor is 169s. (RF
does not draw from F today in any case; it repeats an already-pushed log item.)

**Recommended thresholds, for review:**

- **Trigger on time, not depth.** Fire only when committed audio genuinely runs out
  before the ID is due. On this sample that is never.
- **Early-air window ≈ 45s.** Below the 60s point where closing a gap would need four or
  more stacked liners, above the 15s imaging cliff, and far below the 169s music floor —
  so airing the ID early strictly dominates injecting any record.
- **`maxEarlyDriftMs` ≈ 30–45s against `maxLateDriftMs` 300s** (~7:1). An ID at :59:20
  still reads as top-of-hour to a listener; §2's ambiguity argument bites nearer :58, not
  at half a minute.
- **`MIN_DEPTH = 3` is unrelated and stays.** It is starvation protection for consecutive
  2–15s imaging, and independently the §4c `LoadTrackToTop` guard.

**Open questions for review:**

1. **Is the trigger, not the selection, the real defect?** The filler fires on queue
   DEPTH (`depth <= 1`, items) while the thing it guards against is a TIME gap. On a
   correctly-sized hour the queue is SUPPOSED to be nearly empty just before :00, and
   the depth rule reads that healthy state as an underrun. Fixing selection makes a
   spurious fire cheap; fixing the trigger stops it firing at all. Probably both.
2. **Should the ID simply air early instead?** It is a 2-5s element. Airing it 40s
   early is inside the station's stated tolerance (<= one song either side of :00),
   where injecting 434s is not. If that is adopted, filler near a boundary may become
   dead code — and dead code is better than clever code.
3. **Eligibility of imaging.** Repeating a liner is cheap; repeating a station promo
   may not be, and repeating a TOH ID is never acceptable. Needs an explicit
   allow-list by category rather than "anything that is not a fixed_event".
4. **Interaction with `maxEarlyDriftMs = 0`.** Generation currently forbids early
   drift outright, which is what corners the pacer into bridging rather than letting
   the boundary arrive. The two settings must be decided together, not separately.

## 5b. Backward tolerance — DECIDED

- **Decided:** 2026-08-20 · **Values:** `maxEarlyDriftMs = 30s`, hard cap 45s, `maxLateDriftMs` unchanged at 300s

### The two interests

1. The ID should land, **on average, exactly at :00**.
2. **Backward drift should be minimised**, because the ID represents :00 in a listener's
   mind and an early one misrepresents it.

These read as opposed. They are not, and the reason is arithmetic: with
`maxEarlyDriftMs = 0` the fit may only land at or after target, so **E[drift] is strictly
positive and can never average :00**. Every hour's residual becomes carry, carry saturates
the 300s clamp, and the excess is discarded into real drift. **Interest 1 requires a
non-zero backward bound as a precondition, not as a concession to interest 2.**

### Why 30s is enough

The bound only has to let the reachable grid STRADDLE the target. Grid spacing near the
target is set by the closing pool's density, and F is dense: sorted durations 169-245s
have a **maximum interior gap of 6s** (a single 26s jump to the 271s outlier), so the
worst-case half-gap is **3s**. Removals combine with additions -- shed a 231s gold slot,
add a 194s F, net -37s -- so an hour never has to swallow a whole item's overshoot.

Measured landing error against an exact fit (`a6162ef`): p95 of **23s at 3 closing
candidates, 6s at 5, 1s at 10, 0s at 25+**.

30s is therefore 5-10x the p95 error: wide enough that the bound never binds in normal
operation, narrow enough that the ID still reads as top-of-hour. §2's "which hour is this
identifying?" ambiguity bites near :58, not at :59:30. The 45s cap is the point a listener
glancing at a clock would place the ID in the wrong hour.

The ~10:1 asymmetry against 300s late preserves §2's principle that late is cheaper
than early.

### Revisiting a prior conclusion

`a6162ef` concluded "maxEarlyDriftMs stays 0", on the finding that widening the bound buys
little against an exact fit. That finding stands, and is why this is 30s rather than the
85s the greedy fit suggested. But it assumed the fit was in the production path.
**It is not:** `fitHour()` is exported and tested, and called only by
`tools/drift-curve.mts`. `generate.ts` still uses the `ceil` filler activation, which is
why the measured residual is 48 hours over, 0 short, median 117s. The value of a non-zero
bound is not precision -- it is making the average reachable at all.

## 5c. Hours as first-class objects, and per-slot drop priority

- **Status:** direction agreed 2026-08-20 · **Not yet scoped**

**The affordance wanted:** a PD/MD must be able to say *this slot, early in the hour, is
the first thing to give up* if drift logic needs to shed time. Treating the tail as the
only sacrifice denies that choice.

**How much already supports it:**

- `fitHour()` takes `removable: FitUnit[]` -- an arbitrary set of positions, not a tail.
  Every subset is enumerated exactly (cap `MAX_REMOVABLE = 12`).
- `clock_positions.constraints` already stores `trimPriority` **per position**, and
  `generate.ts` sorts sacrifice candidates by it.

**What does not:**

- `tools/m4-seed.mjs` authors `TRIM_PRIORITY` **by category** (`G1990: 1, G2000: 2, ...`),
  so every G1990 slot in an hour shares one priority. The engine cannot distinguish the
  G1990 at :12 from the one at :47 -- not because it lacks the expressiveness, but because
  nothing authored the difference.
- A log is a flat item list spanning its whole window, so "this hour's drop order" is not
  an addressable object a PD can edit or a reviewer can see.

**What atomising buys beyond the affordance:**

- A generation lapse costs one hour instead of a day. (Observed 2026-08-18/19: two logs
  in six days, with a five-hour hole.)
- `regenerateTail(log, fromCursor)` (spec §7) becomes natural rather than item surgery.
- Per-hour approve/regenerate in the UI.

**The hard part, stated honestly.** Hours are NOT independent: `generateLog` carries
`SeparationState`, `recentMusic` and `hourCounts` across hours in one loop, and artist
separation is 45 minutes. So "self-contained" must mean **independently addressable and
correctable**, with explicit state edges -- `carry_in`/`carry_out` for drift, and a
rotation/separation continuation -- not independently generable in isolation. Making those
edges explicit is the refactor; it is also what turns each hour into a pure function of
(clock, pools, carry-in) -> (items, carry-out).

**A caution for whoever scopes it.** Dropping an early slot is not musically equivalent to
dropping the tail: it changes what the listener hears *before* the correction, and it
interacts with imaging cadence. Per-slot priority should be a PD-settable **default that
still favours the tail**, not an invitation to shed from the top. It also forces the
decision pre-flight, which is where §4 says it belongs.

## 6. Open work

- **Rung 3 needs the vocal-end analysis** before it can be built safely. That is the
  dependency, not the cue-writing itself.
- **The changeset contract needs a field-update operation** (v1 carries pool moves only)
  before cue points can be written reviewably and reversibly.
- **Capability probing should cover rate control** so rung 4 is discovered rather than
  assumed, per invariant #1.
- **Log-review tooling should report shear composition**, not shear count — and flag any
  in-flight filler as a generation miss.
- **`fitHour()` is not wired into `generate.ts`.** The exact fit of `a6162ef` is exported,
  tested, and reached only by `tools/drift-curve.mts`; production still runs the `ceil`
  filler path. Wiring it is the prerequisite for §5b's bound to do anything, and for §5c's
  per-slot `removable` set to be consulted at all.
