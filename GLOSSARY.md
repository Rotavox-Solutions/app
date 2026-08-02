# Glossary

Vocabulary developed while building the M4 format. Terms marked **(ours)** were coined
or given a specific operational meaning in this work; the rest are standard radio or
scheduling terms used here with a precise definition.

---

## Format & positioning

**Cume** — cumulative audience: the count of *distinct* listeners over a period. Grows
by acquisition. Contrast TSL.

**TSL** — time spent listening: how long each listener stays. Grows by retention.
`Total listening hours = cume × TSL`, so a format decision that trades one for the
other has to know which is binding.

**Cume-driven block / TSL-driven block (ours)** — a block whose audience is mostly
arriving (short sessions, low repeat) versus mostly staying (long sessions, habitual).
Determines how much repetition costs there: repetition in a cume block is heard once by
people who do not return; in a TSL block it is heard weekly by the same person.

**Accumulation mode / retention mode (ours)** — which phase the station is in. In
accumulation mode (~no repeat listeners) freshness protects an audience you do not yet
have, while pacing protects the one you are trying to acquire. The correct optimisation
target differs, and the mode should be stated rather than assumed.

**Format of record (ours)** — the format label the station is actually operating,
derived from rotation behaviour rather than from the library's centre of gravity. The
BOLT's is **Alternative CHR ("New Rock")** — 45% currents, where Active Rock runs ~19%.
See `FORMAT-WORKFLOW.md` §0a.

**Active Rock** — harder, male-skewing rock format; gold- and recurrent-heavy, ~19%
currents. What the library looks like; not what the schedule does.

**Alternative CHR / "New Rock"** — CHR current-intensity applied to alt/active-rock
content. The format of record here.

---

## Category structure

**Category / pool** — a bucket a song sits in for scheduling purposes. Currents (A1,
A2, B, C, N), Recurrents (R1–R3), Gold (G2010, G2000, G1990, H), Discovery.

**Lifecycle state (ours)** — a *directional* property of a song — rising, falling,
rested, benched — as distinct from the pool it currently occupies. Encoding direction
as a pool (B-rising vs B-falling) means someone must hand-maintain it forever. See
ADR-0001 §3.7.

**`Z[x]` convention** — the station's existing naming for rested songs: `ZN` means
"rested, and was in N immediately prior." A record of lifecycle state, not a mechanism
for it — which is why the rest pool accumulated 148 songs against an 8-song entry pool.

**Bench** — `W`, songs deliberately out of rotation. Distinct from *rested*, which is
temporary.

**Heritage (H)** — pre-1990 gold. In an Alternative CHR format it is seasoning rather
than staple; in Active Rock it would be a staple.

**Depth** — the number of *enabled* songs in a category. Enabled is the operative word:
the engine filters on it (`packages/engine/src/candidates.ts`), so disabled songs are
not supply.

**Pyramid (ours)** — the requirement that depth *widens* as the ladder descends while
pacing *lightens*. A power tier is narrow and hot; lower tiers wide and light. A2
shallower than A1 is inverted and indicates a slot-allocation error upstream.

**Residency** — how many weeks a song spends in a category before moving on. Sourced
figure: currents overall ~20 weeks (Mediabase removes songs trending below No. 10 after
20 weeks). Per-tier splits are assumptions. Residency is the correct **horizon** for
measuring freshness — a metric run over 26 weeks on a pool that turns over in 6 measures
a world that does not exist.

---

## Rotation metrics

**Slot / cell (ours)** — one `(day-of-week, hour)` position in the 168-hour week. A
habitual listener occupies one cell per week; this is the unit freshness is measured in.

**Turnover** — hours for a category to cycle its whole pool once.
`turnover = 168 × depth ÷ slots_per_week`

**Pacing** — plays per song per day. `pacing = 24 ÷ turnover`. The format's character
lives here.

**Drift — the lead metric (ours)** — how far a song's play pattern moves each day, as a
fraction of its own rotation.
`drift = frac(pacing) = (24 mod turnover) ÷ turnover`
Subsumes two narrower tests and carries the magnitude they discard:
- `drift ≈ 0 or 1` → the pattern barely moves; this is the "integer plays per day"
  failure, which pins a song to the same clock times.
- `drift ≈ p/q` → the pattern realigns after **q days**.
- `drift ≈ 0.618` (**golden drift**) → the value furthest from every simple rational, so
  the pattern takes longest to realign.

**Lock period / lock days (ours)** — smallest `q` where the pattern realigns to within an
hour. Read together with drift: drift says how fast it moves, lock says how long before
it comes back.

**Hour return (ours)** — the multi-cycle version of drift, and the failure single-cycle
drift misses. N at 16.31h turnover has 7.7h of drift per play, which looks healthy, but
`3 × 16.31 = 48.9h` — three plays later, two days on, it is back within an hour of where
it started.

**Relock cycle (ours)** — when a whole category's rotation returns to phase:
`depth ÷ gcd(slots_per_week, depth)` weeks. Applies fully to gold and recurrents, which
sit for months to years; largely dissolves for currents, whose pools turn over first.
Judge it on **absolute cycle length** against human pattern detection (~8–12 weeks), not
as a ratio to residency — H relocking 14.9× across a decade sounds alarming but its
absolute cycle is 35 weeks, which nobody perceives.

**Week-to-week repeat / cume repeat (ours)** — the listener-facing freshness measure: for
someone in a fixed weekly slot, the share of weeks they hear a song they heard in that
slot last week. **Lower is better.** Stable across observation windows.

**Slot freshness (deprecated, ours)** — an earlier measure, `distinct songs ÷ total plays`
in a cell. Bounded by `depth ÷ (plays-per-cell × weeks)`, so it decays as the window
grows however good the rotation is. It measured the window, not the listener. Superseded
by week-to-week repeat.

**Plays per cell per week (ours)** — the density that governs freshness. Empirical rule:
`depth ≥ ~3.5 × plays-per-cell-per-week` keeps week-to-week repeat low. A cume cell at
3 A1/hr needs ~11 A1 songs; at 4/hr it needs ~14 — so raising density *costs* pacing
rather than buying it.

**Horizontal rotation / horizontal separation** — keeping a song off the same *time of
day* on successive plays. Distinct from **vertical separation** (artist, title, album),
which keeps unlike things apart within an hour. Implemented as
`horizontal_separation { windowHours, minDays }`.

**Yield (ours)** — share of slots where the horizontal rule cannot be satisfied and the
engine's ladder relaxes. As important as the freshness number: a rule yielding on most
slots is not scheduling, it is just making the engine relax — and a yield drops album
separation and tempo clash with it. Constraining yield to ≤25% *improved* both metrics.

**Exchange rate (ours)** — the measured cost of pacing in freshness. At 3 A1/hr:
5.8h→16%, 5.3h→24%, 4.8h→52%, 4.2h→81% cume repeat. Below 5.3h each half-hour of pacing
roughly doubles repetition.

**Knife-edge vs plateau (ours)** — whether a good depth has good neighbours. 4/hr peak at
depth 12 measures 1% but its neighbours read 92% and 42%; against a weekly add/drop cycle
that is untenable regardless of how good the number looks.

---

## Schedule structure

**Block (ours)** — a named group of hours sharing one clock and one identity, replacing
inherited daypart names. Derived from an hour-by-hour audience resolution, not from
broadcast convention. The BOLT's ten: **Eastern Sunrise, Full Footprint, Home Drive,
Continental, Weekend Wide, Wind Down, Golden Hour, European Morning, Deep Night A/B**.

**Format grid** — the 168-cell map of `(day, hour) → clock`.

**Clock** — an hour template: an ordered list of positions, each calling a category.

**Clock shape (ours)** — the *counts* per category in a clock, before ordering.

**Position order (ours)** — the air sequence. Uses **two-level proportional placement**:
tiers are spread across the hour first, then categories within their own tier's slots.
Placing each category independently stacks singletons — three recurrent tiers with one
position each all resolve to the same midpoint.

**Contextual imaging (ours)** — placing imaging by what it adjoins rather than as filler:
a New-Music sweeper ahead of a new track, a Gold Backsell behind a gold one.

**Imaging density (ours)** — how many music items run between imaging breaks, scaled to
each block's cume profile. Peak blocks break every 2 songs; Deep Night runs 5-song
sweeps, since interruption costs more than identity in low-cume long-session hours.

**Music sweep** — consecutive music positions with no imaging between them.

**Fallback / fallback policy** — what a position takes when its category cannot fill.
**Unplanned fallback is still programming**: under M3, G2010 carried 651 fallback slots
on top of its own 368, and the station's gold-heavy sound was a *symptom of shallow
currents* rather than a design choice. Governing rule here: **currents never fall back to
gold.**

**Trim-to-fit** — dropping clock positions from the tail when the hour is full, so the
top of the next hour stays on time.

**TOH** — top of hour. **Per-block TOH (ours)**: separate TOH ID categories per block, so
the hour opens with what the station *is* at that moment (subcats 40–48).

**Block identity (ours)** — what the station is during a block. Drives imaging copy, so
it has to be written down rather than assumed.

---

## System & engine

**Rotavox / Scheduler / Runner / Engine** — the SaaS scheduler, the local agent on the
broadcast box, and the pure-TypeScript scheduling core.

**Log** — the pre-resolved running order the Runner paces into RadioDJ.

**Injection by song ID** — loading a specific library track via the REST plugin so
RadioDJ updates history and counters natively. Never by file path.

**Mirror / sync** — the Scheduler's cached copy of the RadioDJ library. A derived cache,
not a source of truth, and it must be re-synced after every library change and before any
log generation.

**Changeset** — the reviewable, reversible unit by which music-direction decisions reach
the library. Keyed on `rdj_song_id`, carries each operation's `from` state as a
**precondition**, and yields an **inverse changeset** as its rollback artifact. See
`CHANGESET-CONTRACT.md`.

**Category sheet (ours)** — the self-sufficient text artifact the changeset is authored
against: every fact needed for a decision, since the authoring side has no database
access.

**Library ↔ clockset contract (ours)** — the recorded binding between scheduler
categories and RadioDJ subcategory IDs. Its absence let subcategory 34 sit unmapped
through the entire M2 era. `LIBRARY-CONTRACT.md`.

**Rung / relaxation ladder** — the engine's ordered fallback when a position cannot fill:
each rung keeps every prior relaxation. **Secondary-hard** is the rung carrying quality
rules (album separation, tempo clash, horizontal separation) — they yield before the
schedule goes unfilled.

**Rest score** — `min(hoursSince ÷ targetTurnover, 2) ÷ 2`. On an untagged library the
engine degrades to "rest + jitter", which is a rest-ordered queue — precisely the
mechanism that produces time-of-day lock.

**Hour-spread score (ours)** — soft companion to the horizontal rule: rewards a candidate
whose slot hour is far from that song's recent play hours, taking the *nearest* prior
play rather than the average.

**Watchdog / heartbeat** — forces `EnableAutoDJ=1` after 20 seconds of stale pacer
heartbeat. Blind fallback is therefore automatic, not an edge case.

**Mount intro** — Icecast's per-mount `<intro>` file, streamed to each client before it
joins the live feed. The only element with **100% new-listener reach**, and it sits
outside the log entirely (ADR-0001 §3.5a).

**Introspection** — discovering RadioDJ's schema and REST command set at runtime rather
than hardcoding them. Invariant #1.

---

## Method

**Audience priority matrix (ours)** — resolving each of the 168 cells by who is plausibly
listening, across weighted regions and local-hour propensity. Timezone arithmetic is
fact; propensity curves are assumptions. `tools/daypart-matrix.mjs`.

**Convergence loop (ours)** — clock proportions, turnover standard, derived depth,
reconcile, repeat. Clock shapes and category depths are mutually determining, so neither
can be finalised alone. `FORMAT-WORKFLOW.md` Phase 1c.

**Horizon (ours)** — the observation window a metric is measured over. Must match
category residency or the metric describes a world that does not exist.

**Build vs operating cycle (ours)** — Phases 0–3 run on a format reset; Phase 4 is the
weekly cycle of adds, drops, lifecycle transitions and log approval. Conflating them is
what makes routine music direction feel like a project.
