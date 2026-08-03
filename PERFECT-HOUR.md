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

## 6. Open work

- **Rung 3 needs the vocal-end analysis** before it can be built safely. That is the
  dependency, not the cue-writing itself.
- **The changeset contract needs a field-update operation** (v1 carries pool moves only)
  before cue points can be written reviewably and reversibly.
- **Capability probing should cover rate control** so rung 4 is discovered rather than
  assumed, per invariant #1.
- **Log-review tooling should report shear composition**, not shear count — and flag any
  in-flight filler as a generation miss.
