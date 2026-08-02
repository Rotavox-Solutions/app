# Format Workflow

- **Date:** 2026-08-01
- **Scope:** how a format gets built, changed, and run — from positioning to air
- **Related:** `ADR-0001-source-of-truth-and-ownership.md` (who owns what),
  `CHANGESET-CONTRACT.md` (how library changes are applied),
  `DAYPART-ANALYSIS.md` (how dayparts are derived), `M4-SCHEDULE.md` (current proposal)

Phases 0–3 are the **build**, run rarely — on a format reset or a station launch.
Phase 4 is the **operating cycle**, run weekly and forever. Phase 5 runs continuously
and feeds the next build. Conflating build and operations is what causes routine
music direction to be treated as a project.

---

## Phase 0 — Positioning

Rarely revisited. Everything downstream inherits from these.

1. **Target listener.** Demo, and — for internet radio specifically — their *schedule*.
   Who listens at 3am local, and are they night-shift locals or someone's mid-morning?
2. **Target geography and anchor timezone.** Which regions, in what weight, and which
   timezone the grid is anchored to. The station's own zone is a default, not a
   conclusion.
3. **DST policy.** The US and Europe do not change on the same dates, so twice a year
   there are multi-week windows when every cross-region mapping shifts by an hour.
   Decide once: re-anchor, accept drift, or maintain a seasonal grid.
4. **Format definition.** The thing the categories have to express. **Settled
   2026-08-02 — see below.**

### 0a. Format of record: Alternative CHR ("New Rock")

**The BOLT is not an Active Rock station**, whatever the library's centre of gravity
suggests. Format is defined by rotation behaviour, and the M4 clocks assert:

| | Currents | Recurrents | Gold | Discovery |
|---|---|---|---|---|
| **The BOLT (M4)** | **45%** | 20% | 29% | 6% |
| Active Rock | ~19% | — | — | — |
| Alternative / Modern Rock | ~30–40% | — | — | — |
| CHR / Top 40 | ~40–50% | — | — | — |

Half the music is current or discovery. That is CHR current-intensity applied to
alt/active-rock content — Shinedown, Deftones, Spiritbox and Sleep Token alongside
alt-pop crossover (Sombr, Role Model, Djo). The format of record is therefore
**Alternative CHR**, trade-named "New Rock". Confirmed by the PD 2026-08-02.

**Why the deviation from Active Rock is deliberate, not drift.** Terrestrial Active
Rock defends a signal against competitors playing the same familiar records, so
familiarity is its weapon and a ~19% current share follows. The BOLT acquires
listeners through directory search on onlineradiobox and radio.net, where familiarity
is worth nothing — nobody scrolls a station list hoping to hear a song they already
know. Discovery is the only competitive surface the distribution channel offers, so a
high current share is the correct response to it. The percentages are asserted, not
inherited.

**What inherits from this label.** It is not nomenclature; three things depend on it:

1. **Directory genre tagging.** The listing category *is* the acquisition funnel.
   Tagged "Active Rock", the station is presented to listeners who came for
   familiarity and will leave inside fifteen seconds. Tagged Alternative / Modern
   Rock, it reaches people looking for new music.
2. **Imaging language.** The TOH scripts and the mount intro (ADR §3.5a) must state
   the promise the station actually keeps — "new rock first", not "Vegas rock".
3. **What gold means.** In a current-forward alternative format, gold is 2000s–2010s
   alternative with 90s alt as the deep canon. **Open question:** Heritage (pre-1990)
   is targeted at 142 songs, which is an Active Rock instinct. Whether it belongs
   depends on its contents — post-punk and new-wave canon is alternative heritage and
   fits; classic rock is another format's gold and will read as incoherent next to
   Spiritbox. **Resolved 2026-08-02** by §0b.2: pre-1990 inclusion is a value
   proposition, not an Active Rock hangover. H was split into H1 (alt canon, depth 24)
   and H2 (pre-1980, depth 97).

### 0b. Value propositions — what makes the station worth choosing

Recorded 2026-08-02. **These are programming inputs, not marketing copy.** They
constrain how far any external chart may be followed, and they exist here because the
alternative is applying them invisibly — which is exactly how four texture judgments
got made and silently overturned during the first currents refresh.

1. **The hybrid.** Light-CHR current intensity over a combined **Active Rock ×
   Alternative** vein. An uncommon variant, not either parent format. A record's fit is
   judged against the hybrid, not against whichever parent chart it appears on.
2. **Pre-1990 inclusion.** H1 (alt canon) and H2 (pre-1980) as deliberate seasoning. No
   chart rewards this and no chart ever will; it is a differentiator precisely because
   it is unmeasured.
3. **Deliberate deviation from US airplay charts**, as a function of internet radio's
   global reach. The station is distributed worldwide and its format grid is built on a
   weighted global audience matrix — the blocks are literally named **European Morning**
   and **Continental**. A playlist that mirrors US airplay has no reason to be chosen
   over the US stations that *are* those charts.

**The permission these grant.** The station is in accumulation mode with effectively no
repeat listeners (~80% of connections abort inside a minute). **There is no TSL at risk
from deviating from chart orthodoxy** — the risk runs the other way. Conformity is the
expensive choice while the audience is being acquired; it should be re-evaluated once
retention-mode behaviour appears in the AzuraCast data, not before.

**What inherits from this.** Chart research is a *panel*, weighted by
**format × measurement type × geography** — see Phase 4. A US chart position is evidence
about the US market only. Absence from a US chart is not evidence of absence.

---

## Phase 1 — Architecture

### 1a. Structure

5. **Music category structure.** Tiers and their meaning. Distinguish *pools* (a bucket
   a song sits in) from *lifecycle states* (rising, falling, rested, benched). If a
   distinction is directional — B-rising vs B-falling — it is a state, not a pool, and
   modelling it as a pool means someone must hand-maintain it forever. See ADR §3.7.
6. **Rotation and separation rules.** Artist/title/album separation, max-per-hour,
   daypart constraints, hard vs soft with weights. **Not an afterthought:** rules
   interact with depth. A 30-minute in-currents artist separation against a 7-song pool
   with duplicate artists produces fill failures, not just tighter rotation.
7. **Fallback policy.** What each position type falls through to when it cannot fill.
   This is a design decision with large audible consequences — under M3, G2010 carried
   651 fallback slots on top of its own 368, which is why the station sounded
   gold-heavy. Unplanned fallback is still programming.

### 1b. Time

8. **Daypart boundaries.** Derived from an hour-by-hour audience resolution across the
   target regions, not from inherited broadcast daypart names. See `DAYPART-ANALYSIS.md`
   and `tools/daypart-matrix.mjs`.
9. **Block identity per daypart.** What the station *is* in each block. This drives
   imaging copy later, so it must be written down, not assumed.

### 1c. The convergence loop — steps 10–13 iterate

**Clock shapes and category depths are mutually determining.** Clocks set demand, depth
sets supply, turnover is the ratio. Neither can be finalized alone. Run this until it
converges:

10. **Clock proportions per block** — as *percentages* of the hour (currents / recurrents
    / gold / discovery), not absolute position counts.
11. **Turnover standard per category** — target plays per song per day, or equivalently
    hours to cycle the pool. This is a programming judgment and the single most
    load-bearing number in the format. It cannot be derived from the library; it comes
    from the format definition.
12. **Derive required depth** = weekly slots ÷ target plays per song per week.
13. **Reconcile.** If a required depth is unreachable — no more qualifying music exists,
    or the pool would be absurdly thin — revise the proportions (10) or the standard
    (11) and repeat. Only when this converges do absolute position counts get written.

> Do not skip to absolute counts. Doing so silently accepts whatever depth the library
> currently holds as the target, which is how a 7-song pool ends up carrying 219 weekly
> slots.

### 1d. Imaging

Order matters here, and the intuitive order is wrong.

14. **Imaging policy.** How often, what kinds, what the station sounds like between songs.
15. **Imaging categories.** Derived from policy and from block identity (9). If the top
    of the hour should reflect what the station is at that moment, TOH IDs are per-block
    categories, not one pool.
16. **Imaging slots in clocks.** Added to the shapes from 1c.
17. **Inventory audit.** What exists, what is enabled, what is retired. Enabled depth is
    the real depth — the engine filters on it.
18. **Production brief for the gaps only.** Counts derived from 16 and 17 against a
    repetition threshold. Producing before 15 and 17 means producing blind.

---

## Phase 2 — Realization

19. **Curate the library to target depth.** Via changeset — authored, reviewed, validated
    against live, applied by the Runner, inverse emitted. Never ad-hoc SQL.
    See `CHANGESET-CONTRACT.md`.
20. **Produce and ingest new imaging** under the categories from 15.
21. **Sync the library to Rotavox.** Must run *after* every library change and *before*
    any log generation — a log generated in between uses stale pool membership.
22. **Migrate and seed Rotavox:** categories, clocks, format grid, rules.
23. **Verify the seed resolves.** Every category maps to a non-empty pool; every fallback
    resolves; every grid cell has a clock. A category that silently resolves to zero
    songs is the failure mode this catches — it is what kept Gold Backsells off the air
    for the entire M2 era.

---

## Phase 3 — First air

24. **Generate the log.**
25. **Review the log against intent.** Not a spot check — a comparison:
    - Does the realized mix match the designed mix, per block?
    - Which positions fell back, and to what? High fallback means 1c did not converge.
    - Any unfilled positions?
    - Does separation hold, or is the engine relaxing to fill?
    The engine fails quietly by design. This is where that becomes visible, and it is
    the step most likely to send you back to Phase 1c.
26. **Approve.** 27. **Pace to air.** 28. **Airbench** — listen to it.

---

## Phase 4 — The operating cycle (weekly, forever)

Distinct from the build. None of these should feel like a project.

- **Chart research.** A weighted **panel**, not a chart. Three axes:
  **format** (a rock record is read on the rock chart, an alternative record on the
  alternative chart — using one for both inverts the ladder), **measurement type**
  (airplay charts govern promotion and demotion; composite/consumption charts are an
  *entry signal only*, since consumption leads airplay), and **geography** (§0b.3).

  | Panel | Status | Notes |
  |---|---|---|
  | Mediabase Active Rock (US) | in use | airplay; AllAccess account, Tuesday PM, no programmatic access |
  | Mediabase Alternative (US) | in use | airplay; same constraints |
  | RadioWave ALT/ROCK 100 | in use | composite — **entry signal only** |
  | Radio X (UK) | **not yet** | closest analogue to the hybrid; playlist adds are direct airplay |
  | Triple J (AU) | **not yet** | arguably the best format match anywhere; English-native |
  | Official Charts Co. (UK) Rock & Metal | **not yet** | |
  | German / Dutch / Nordic alternative | **not yet** | the Continental block has nothing informing it |
  | **AzuraCast listener behaviour** | Phase 5 | see below |

  **Weights are not yet calibrated.** They should be, against outcomes — keep a
  per-chart accuracy log rather than guessing. And record texture exclusions explicitly;
  a record dropped for format fit under §0b.1 is a legitimate call, but only if it is
  written down where it can be weighed against the charts.

  **AzuraCast eventually outranks the whole panel.** External charts are a prior;
  session-length and skip data are the posterior, and the only source measuring *this*
  station's audience. Down-weight the external panel progressively as behavioural weeks
  accumulate.

- **Adds and drops.** New music into the currents entry pool; retirements out. Sourcing
  runs **N-first** — new music enters at the entry pool and everything above is fed by
  promotion. Skipping N is an exception requiring a reason: an overlooked hot record, one
  that could not be sourced in time, or a net vacancy that N cannot fill this week. Some
  records retire from N rather than promote.
- **Lifecycle transitions.** Rising → falling → rest → recurrent → gold → bench.
  Currently manual, which is why the rest pool accumulated 148 songs against an
  8-song entry pool. Target state is standing rules that emit changesets for review.
- **Changeset → validate → apply → re-sync.** Every library change, without exception.
- **Log generation, review, approval.**
- **Exception review.** Fallback rates, unfilled positions, separation relaxations —
  trends here are the early warning that depth has drifted from the format.

Quarterly or on drift: re-run the Phase 1c convergence loop against current depths.

---

## Phase 5 — Instrumentation (start now, not later)

29. **Capture listener sessions** — geo, timezone, session length, tune-out point,
    alongside `play_history`.
30. **Feed measurement back into Phase 0–1b.** The daypart matrix currently runs on
    assumed propensity curves; the timezone arithmetic is fact but the listening shape
    is a model. Until sessions are captured, every daypart decision is an argument from
    first principles rather than evidence.

This phase has no dependencies and blocks nothing — which is exactly why it keeps not
happening. It has already blocked three decisions (daypart weighting, TSL vs cume
targeting, and now chart-panel weighting per Phase 4) and will block the same ones
again next quarter. It is also the only thing that can tell us when accumulation mode
ends, which is the condition §0b attaches to re-evaluating chart conformity.

---

## Current state against this workflow

| Phase | Status |
|---|---|
| 0 | Format settled 2026-08-02 (§0a, Alternative CHR); geography/weights settled 2026-08-01; **DST policy open**; **H contents unaudited** |
| 1a | Categories exist; **lifecycle states unmodelled**; rules exist, unvalidated against depth |
| 1b | Done — `DAYPART-ANALYSIS.md`, 8 blocks + EM split |
| 1c | **Not converged.** Absolute counts were written before a turnover standard was set. A1 depth is the binding input |
| 1d | Policy implicit; per-block TOH categories decided; production brief issued (~50 scripts) |
| 2 | Changeset contract and applier built and tested; **no changeset authored yet** |
| 3 | Log review step does not exist as tooling |
| 4 | Ad-hoc |
| 5 | **Nothing exists** |
