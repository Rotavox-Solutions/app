# ADR-0001 — Source of Truth & Ownership Boundaries

- **Status:** Accepted (amended 2026-07-31 — §3.5 revised, see §8)
- **Date:** 2026-07-31
- **Context:** Rotavox / CLUBFM (station: The BOLT), post-M3 clockset, pre-airbench
- **Supersedes:** nothing
- **Related:** `clubfm-scheduler-phase-one-spec.md` (§1 non-goals, §5 schema, §6 clocks)

---

## 1. Context

Phase one shipped a working scheduler without ever writing down *who owns which
facts*. That was fine while Rotavox only read from RadioDJ. It stopped being fine
on 2026-07-30, when a music-direction decision (reclassifying 312 songs out of the
W bench into currents/recurrents/gold) had to be executed as hand-written `UPDATE`
statements against live MariaDB, with a hand-written rollback script. The decision
was Rotavox's; the data it changed was RadioDJ's; nothing in the system recorded
that the two had to agree.

The same ambiguity shows up in the clockset. `packages/schema/seed/m3-clubfm-seed.sql`
binds scheduler categories to RadioDJ subcategory IDs (lines 53–76) and was *sized*
against live pool depths — but nothing enforces or even records that coupling. A
subcategory renumbered in RadioDJ yields a silently empty scheduler category.

This ADR establishes the ownership line, the sync policy for each domain, and what
is deliberately left unsynced.

### 1a. What is actually true today (verified, not assumed)

Recorded so future readers don't re-derive it:

- **The Runner writes nothing to RadioDJ's database.** The only write path in the
  entire system is REST `LoadTrackToBottom` / `LoadTrackToTop` (`apps/runner/src/rest.ts`).
- **It reads:** `songs` (artist, title, album, path, duration, subcategory, genre,
  enabled, song_type, date_modified), `subcategory.parentid` (to resolve category —
  RadioDJ has no `category_id` on songs), and `history`
  (`apps/runner/src/sync-library.ts`, `apps/runner/src/reconcile-history.ts`).
- **It ignores RadioDJ's own rotations, events, and category-rule tables entirely.**
  This is correct and is now policy (§3.5).
- **Rules are already a first-class input.** `rules(scope, scope_ref, rule_type,
  params, hardness, weight)` is resolved by the engine for `artist_separation`,
  `title_separation`, `album_separation`, `tempo_clash`, `max_per_hour`, daypart
  constraints, and `era_spread` — scoped global or per-category, hard or soft with
  weights (`packages/engine/src/rules.ts`). What is missing is an authoring UI, not
  the capability.
- **Extended song metadata is already Scheduler-owned in schema.** `era`, `tempo`,
  `energy`, `mood`, `sound_codes[]`, `hook_ms`, `intro_ms`, `outro_ms` are
  deliberately excluded from the sync upsert set so a re-sync cannot clobber them
  (`packages/schema/src/schema.ts:54-65`, `apps/runner/src/sync-library.ts:88-109`).
  Nothing populates them yet, so `tempo_clash` and `era_spread` currently score
  against nulls.
- **Clocksets are not authored by Rotavox.** `apps/web` exposes logs, log detail,
  as-run reporting, and song search. No route touches `clocks`, `clock_positions`,
  `format_grid`, `categories`, or `rules`. The format is authored by hand-editing a
  SQL seed.

---

## 2. Decision

**Rotavox owns intent. The playout system owns inventory and playout.**

Every rule below follows from that line. It is also the line that preserves
system-agnosticism: intent is portable, inventory and playout are what a playout
adapter abstracts.

### Ownership matrix

| Domain | SoT today | SoT target | Sync policy |
|---|---|---|---|
| Song existence, path, duration, enabled | RadioDJ | RadioDJ | Rotavox caches; watermarked incremental pull |
| **Pool assignment** (A1 / R2 / G1990 / W …) | RadioDJ | **Rotavox** | Migrates — see §3.2 |
| Musical codes (tempo, key, energy, sound codes, hooks) | Rotavox (unpopulated) | Rotavox | Derived by Rotavox; never read back from RadioDJ |
| Clocks, clock positions, format grid, dayparts | Rotavox | Rotavox | Never leaves Rotavox |
| Separation & rotation rules | Rotavox | Rotavox | Never leaves Rotavox |
| Log / running order | Rotavox | Rotavox | Injected by song ID only |
| Playout, play history, counters | RadioDJ | RadioDJ | Rotavox reads history back |
| Fallback rotation — *rules* | RadioDJ | **Rotavox** | One-way projection, written ahead of time — §3.5 |
| Fallback rotation — *selection* | RadioDJ | RadioDJ | Unsynced by design; will sound worse — §3.5 |

---

## 3. Rationale, domain by domain

### 3.1 Library composition stays RadioDJ's

Which files exist, where they live, how long they are, whether they're enabled —
these are inventory facts owned by the system that ingests and plays the audio.
Rotavox caches them. This is already how the Runner behaves and it needs no change.

### 3.2 Pool assignment moves to Rotavox

Deciding that a song is a recurrent rather than a current is a *scheduling
judgment* — the core of the music-director role. It lives in RadioDJ today only
because RadioDJ's AutoDJ needed it there to function.

Leaving it there has a concrete, already-realized cost: music direction cannot be
version-controlled, reviewed, or rolled back, and each change is a bespoke script
against a live production database.

**Migration path** (deliberately staged, so the format can ship first):

1. *Today* — RadioDJ is SoT. Rotavox mirrors `id_subcat` and derives `song_categories`
   at seed time. Changes are applied to RadioDJ out-of-band.
2. *Next* — Rotavox becomes the authoring surface. Music-direction changes are
   authored as **changesets** (§4), reviewed, and applied by the Runner.
   RadioDJ remains SoT-of-record; Rotavox is authoritative for *proposed* state.
3. *Then* — flip. Rotavox holds pool assignment; the Runner pushes it down so
   RadioDJ's fallback rotation stays sane. RadioDJ becomes a projection.

### 3.3 Writeback is an adapter capability, not a RadioDJ exception

Pushing pool assignment into the playout system looks like a system-agnosticism
violation. It isn't, if modeled correctly.

Express it as a capability on the playout adapter — `setPoolAssignment(songId, pool)`
— alongside the existing `loadTrackToBottom` / `loadTrackToTop`. Systems with a
bucket concept implement it; systems without simply don't, and Rotavox keeps pool
assignment purely internal for those. The genuinely RadioDJ-specific part is only
the subcategory-ID mapping, which already lives in exactly one place.

This is consistent with invariant #4: *all* RadioDJ contact still goes through the
Runner. It does relax invariant #1's spirit — the Runner will write, not just read —
so writeback must use the same runtime schema introspection, never hardcoded column
names, and must be explicitly opt-in per station.

### 3.4 Musical codes are derived by Rotavox, not read from RadioDJ

RadioDJ's musical-metadata fields are unreliable, and this is now measured rather
than assumed. From a live census on 2026-07-31 (785 scheduler-visible music rows,
excluding the W bench and the unmapped Z/ZN/F pools):

| Pool | Rows | With BPM |
|---|---|---|
| Currents (A1, A2, B1, B2, C, N) + Discovery | 79 | 77 |
| Recurrents (R1–R3) | 98 | 68 |
| **Gold (G1990, G2000, G2010, H, GDEEP)** | **608** | **4** |

BPM coverage on gold is **0.7%** — G1990 has 0 of 187, H has 0 of 101. Since gold is
77% of the schedulable library, `tempo_clash` is not merely sparse, it is structurally
inoperative exactly where the library is deepest. Coverage correlates with import
provenance, not with musical reality: the ZN pool is 148/148 and Z is 5/5, indicating
those arrived from a source that carried tags, while gold was ingested without them.

**Release year is unreliable in a more dangerous way.** Nominal coverage is high
(gold is ~100% populated), but the values are not trustworthy — confirmed by the PD,
2026-07-31. This is worse than absence: the G1990/G2000/G2010 tier boundaries *are*
release year, so wrong years mean songs are currently filed in the wrong gold decade,
and `era_spread` scores against the same bad data. High coverage of untrustworthy
values presents as healthy on any completeness metric.

**Therefore Rotavox derives this data from two sources, neither of them RadioDJ:**

1. **Local analysis** over `songs.path` — BPM, key, energy, loudness. The Runner is
   the only component with filesystem access, so this is an **offline pass** there
   that writes to the Scheduler; never in the injection hot path.
2. **External metadata lookup** — release year and credits.

**Original-release semantics are required, not incidental.** For a gold format the
needed value is the earliest release date of the *recording*, not of the pressing on
disk: a 2015 remaster of a 1994 single is a 90s gold record. MusicBrainz's
`release-group.first-release-date` carries exactly this semantic and is the intended
primary source. Discogs is a reasonable secondary for material MusicBrainz lacks.
Album-date APIs whose values are reissue-contaminated (notably Spotify) must not be
used as a year source.

**Matching is the risk, not fetching.** If year tags are unreliable, artist/title
tags may be too, and a bad match writes a confidently wrong year — which is worse
than no year, because nothing downstream can detect it. Policy:

- Require a scored match above an explicit threshold; leave the remainder
  **unresolved** rather than guessing.
- For unmatched residue, fingerprint the audio (AcoustID/Chromaprint) rather than
  trusting tags. This shares the local-analysis pass: fingerprint once, resolve
  BPM/key/loudness locally and year/credits remotely.
- Store **provenance and confidence** alongside every derived value. "We do not know"
  must be representable and distinguishable from "we know it is 1994." A numeric
  `release_year` with source and confidence is required alongside the existing
  Scheduler-owned `era`.
- **Unresolved year excludes a song from era-tiered gold rotation** rather than
  falling back to the RadioDJ tag. A wrong decade on air is worse than a marginally
  shallower pool.

Correcting years will reclassify a meaningful share of 608 gold rows across tiers.
That reclassification is a **changeset** (§4) — reviewable and reversible — not a
direct write.

Until this pass exists, `tempo_clash` and `era_spread` are scoring against nulls and
bad values respectively, and are effectively inert. This is a known, accepted gap.

### 3.5 Rules project downward, one way; the fallback's *selection* stays its own

**Never read RadioDJ's rules into Rotavox.** Rotavox's log is the final word, and
importing RadioDJ's rule state would create a second authority over the same intent.
Rules are Rotavox-owned, full stop.

**Do project the expressible subset of Rotavox's rules down into RadioDJ**, as a
one-way, generated artifact.

The reason is that the fallback is not a rare event. `apps/runner/src/watchdog.ts`
forces `EnableAutoDJ=1` after **20 seconds** of stale pacer heartbeat, automatically
and without human involvement. Any pacer hiccup hands the station to RadioDJ's own
engine. If its rules are unconfigured, the station goes to air with no separation
enforcement at all — and the PD has to maintain two independent sets of rules to
prevent that, which is precisely the duplicated-truth problem this ADR exists to
eliminate.

This does **not** reintroduce two competing engines. Injected tracks bypass RadioDJ's
rotation rules entirely — those rules bind only when RadioDJ's own AutoDJ selects a
track, which by definition is only when Rotavox is already not driving. And because
the projection is written *ahead of time* rather than at fallback time, the safety
property still holds: **the fallback does not depend on Rotavox being alive at the
moment it engages.**

**The projection is lossy, and must be honest about it.** RadioDJ's separation model
is three columns on `songs` plus the live `queuelist` — coarse artist/title, no
scoping, no weights, no soft rules. Rotavox's model has per-category scope,
hard/soft hardness, and weights. Only a subset survives translation. Therefore:

- Project only what RadioDJ can actually express; never approximate a soft or scoped
  rule into a hard global one.
- Mark projected config as **generated** in RadioDJ so it is never hand-edited.
- Surface non-projectable rules explicitly in Rotavox, so the PD can see what the
  fallback will *not* enforce. Silent omission is the failure mode to avoid — a PD
  who believes the fallback enforces the full ruleset is worse off than one who
  knows it doesn't.

**Selection remains RadioDJ's.** The fallback should still point at a deep, wide gold
pool of its own choosing rather than trying to mirror the format grid. Clock shape,
dayparting, and imaging placement are not expressible in RadioDJ's model and should
not be faked. The fallback will sound worse than the scheduled format; that is
accepted, and is not the same thing as it sounding *broken*.

### 3.6 Rotavox does not become the playout system

Not soon, and possibly not ever. Playout is hard-realtime, 24/7, and
liability-bearing — audio devices, crossfades, silence detection, dead-air watchdogs
— and it is the least differentiated layer in the stack. The scheduling brain is
where the value is.

Keep the adapter boundary clean so the door stays open. Revisit only if RadioDJ
becomes the binding constraint.

### 3.7 Rotation lifecycle is intent, and currently has no owner

Pool assignment is not a static bucket. A song moves through a lifecycle — add →
A1 → A2/B → N → rest → recurrent tier → gold → bench — and those *transitions* are
the substance of music direction, more than any single assignment is.

Today no component owns them. RadioDJ cannot express a lifecycle; Rotavox does not
model one. The station has worked around this by encoding lifecycle state in
subcategory names: the **`Z[x]` convention means "rested, and was in pool *x*
immediately prior"** (PD, 2026-07-31). ZN is therefore rested-from-N, and its
unmapped status in the M2/M3 seeds is **correct and intentional** — rested songs
must not be schedulable.

The convention works as a record. It does not work as a mechanism, and the census
shows the cost: **ZN holds 148 songs while N holds 8.** Songs enter the rest state
and do not leave it, because leaving requires a human to notice. The result is a
reservoir of the library's best-qualified material — every ZN song already earned
currents rotation, and the pool is 100% covered on BPM and year versus gold's ~0.7%
— sitting inert while the currents that feed it stay shallow (67 across six pools,
A1 at 7). The 2026-07-30 reclassification mined the 505-song W bench with 66 agents
while this pool went unexamined.

**Consequence for §3.2 and §4:** a changeset format that expresses only "move song X
to pool Y" reproduces the manual problem in better packaging. Lifecycle transitions
need to be expressible as *rules over state* — time rested, plays accumulated, tier
of origin — with changesets as the reviewable output of applying those rules, not as
the primitive. `Z[x]`'s "pool of origin" is already the state a transition rule would
need; it should become a modeled field rather than a naming convention.

Open: the intended exit path from rest (return to origin pool, promote to recurrent,
or case-by-case) and whether rest has a duration. That answer determines whether
§4 needs a time-based rule engine or only an audited move list.

---

## 4. Changesets: the missing artifact

Music direction is currently formulated in conversation and executed as one-off
scripts. It needs to be a versioned, reviewable artifact.

A **changeset** is a declarative, station-scoped description of intended library
state changes — pool moves, enable/disable, adds, drops — that is:

- authored outside the live system (conversation, UI, or file),
- committed to the repo and reviewable as a diff,
- validated against the current mirror before application,
- applied by the Runner (never by ad-hoc scripts), and
- reversible, with the inverse derivable from the changeset plus the pre-state.

A changeset is the *unit of application*, not the unit of authorship. Per §3.7,
lifecycle transitions should be derived from rules over song state and emitted as
changesets for review — the changeset records what will change and why, while the
rule records the standing policy. A format that only supports hand-listed moves
will scale no better than the scripts it replaces.

This generalizes the 2026-07-30 W reclassification, which had all five properties
informally and none of them structurally. It is the prerequisite for §3.2 step 2.

---

## 5. PD / MD accountability

| Role | Owns | Today | Target |
|---|---|---|---|
| **MD** — library curation, pool assignment, adds/drops, rotation depth | the *contents* of each pool | RadioDJ + manual SQL | Rotavox, via changesets |
| **PD** — clocks, dayparts, format grid, separation policy, imaging placement | the *shape* of the hour | Rotavox (SQL seed only) | Rotavox, via authoring UI |

Rotavox is expected to absorb both roles' tooling over time. It absorbs the PD
tooling first, because it already owns that data and only lacks a UI.

---

## 6. Consequences

**Accepted:**

- The Runner gains a write path to RadioDJ (§3.3), relaxing the read-only posture.
  Mitigated by: runtime introspection, per-station opt-in, changeset review.
- Soft rules stay inert until audio analysis lands (§3.4).
- The fallback's *selection* will diverge from the scheduled format, by design, and
  its *rules* will enforce only a lossy subset of Rotavox's (§3.5).
- Rule projection is a second Runner write path into RadioDJ, subject to the same
  conditions as §3.3: runtime introspection, per-station opt-in, no hardcoded columns.
- Clock authoring stays in SQL until the UI exists; the seed file remains the SoT
  for format shape and must be treated as production configuration.

**Required follow-on work**, in priority order:

1. **Changesets as a first-class artifact** (§4) — highest leverage; unblocks §3.2.
2. **Pool-assignment writeback** as an adapter capability (§3.3) — makes changesets
   round-trip instead of dead-ending in MariaDB.
3. **Rule projection to RadioDJ** (§3.5) — so the auto-engaging fallback isn't blind,
   and the PD maintains one ruleset instead of two. Pairs with:
4. **Fallback-engagement alerting.** The watchdog currently forces `EnableAutoDJ=1`
   and logs to console only. Nobody is notified that the fallback took over or for
   how long — today you find out by listening. If the fallback is worth configuring,
   its engagement is worth observing.
5. **Clock / rule authoring UI** — lifts format authorship out of hand-edited SQL.
6. **Offline audio-analysis pass** (§3.4) — makes the soft rules meaningful.

**Also unaddressed:** the scheduler's Postgres has no documented backup/restore
(`DEPLOY.md` covers neither). Once clocks, rules, and pool assignment all live there,
it stops being a cache and becomes the station's format of record — losing it means
losing the PD's accumulated work, not just a resyncable mirror.

**Immediate, independent of the above:** record the library↔clockset contract. The
seed's subcategory-ID map (`m3-clubfm-seed.sql:53-76`) and the pool depths it was
sized against should be captured as a committed snapshot and diffed against live
before each re-seed. The absence of this check is what allowed subcategory 34
(Gold Backsells, 26 items) to be mapped into no scheduler category under the M2
seed, silently keeping that imaging off the air.

---

## 7. Open questions

- **Rest exit path** — what a `Z[x]` song's intended transition out of rest is
  (return to *x*, promote to recurrent, or case-by-case), and whether rest carries a
  duration. Blocks the §4 format decision; see §3.7.
- **Sonic Logos (32) and Heritage Backsells (35)** — confirmed still empty at the
  2026-07-31 census, and unmapped. Harmless today, silently so. Map when populated.
- **F (31, 5 items, 4 enabled) and Z (38, 5 items)** — unmapped, intent unrecorded.
  Small enough to defer, but should not stay unexplained indefinitely.

### Resolved 2026-07-31

- **ZN (39, 148 items)** — *not* a gap. Rested-from-N under the `Z[x]` convention;
  correctly unmapped, since rested songs must not be schedulable. The lifecycle
  concern it exposed is recorded in §3.7.
- **Disabled imaging** — TOH IDs are 12-enabled of 31 and Relaunch Sweepers
  12-enabled of 46. The engine filters on `enabled`
  (`packages/engine/src/candidates.ts:28`), so those are the true depths against a
  168-hour weekly grid — each TOH ID airs roughly 14×/week. The disabled items are
  **old copy, deliberately held pending a retirement decision** (PD, 2026-07-31), not
  an oversight. They stay disabled for now. Revisit as an imaging-production question,
  not a configuration one.
- **Sequencing:** whether pool-assignment writeback lands before or after the M3
  deploy. Before makes the W reclassification reproducible; after gets the format
  on air sooner.

---

## 8. Amendments

### 2026-07-31 — §3.5 reversed: rules now project downward

**Originally:** "Rules flow in neither direction; the fallback keeps its own truth."
Rotavox's rules were not to be pushed into RadioDJ under any circumstance.

**Now:** rules project one-way into RadioDJ as a generated, lossy artifact.

**Why the original was wrong.** It conflated two distinct things: RadioDJ's engine
running *concurrently* and fighting the log (a genuine problem) with a *projection of
configuration* written ahead of time (not a problem). Injected tracks bypass RadioDJ's
rotation rules, so projected rules cannot interfere while Rotavox is driving.

**What changed the assessment.** `watchdog.ts` auto-engages AutoDJ after 20 seconds of
stale heartbeat. Blind fallback is not an edge case being guarded against — it is an
automatic behavior that fires on any pacer interruption. And the original position
forced the PD to maintain two independent rulesets, contradicting this ADR's own
central purpose.

**What survived unchanged.** The safety argument — a backstop must not depend on the
thing it backstops — still holds, because the projection is written ahead of time
rather than at fallback time. And the fallback's *selection* remains RadioDJ's own;
only rules project.

### 2026-07-31 — §3.4 extended: external metadata enrichment, and year declared untrusted

**Originally:** §3.4 covered locally-derived codes only (BPM, key, energy, loudness)
and asserted RadioDJ's fields were "inconsistently populated" without evidence.

**Now:** the claim is backed by a live census, and the section additionally covers
external metadata lookup for release year.

**What prompted it.** The PD confirmed (2026-07-31) that RadioDJ's year codes are
unreliable as values, not merely sparse. The same day's census quantified the BPM
side: 0.7% coverage across 608 gold rows, versus near-total coverage on currents.

**Why year is treated as a distinct problem class.** Missing data is safe — it scores
as null and the rule goes inert. *Wrong* data is not: it scores confidently and
incorrectly, and 100% nominal coverage makes the problem invisible to completeness
checks. Because the gold tiers are defined by year, bad years mean current
misfiling, not just future risk. This is why §3.4 now requires provenance and
confidence on derived values, and why unresolved-year songs are excluded from
era-tiered rotation rather than falling back to the RadioDJ tag.

### 2026-07-31 — §3.7 added: rotation lifecycle has no owner

**Added** in response to the PD clarifying that `Z[x]` means "rested, was in *x*
immediately prior." That resolved the ZN open question — its unmapped status is
correct, not an oversight — but exposed a larger one: lifecycle *transitions* are
unowned, so the rest state accumulates (ZN 148 vs N 8) and the library's
best-qualified material sits inert.

**Effect on other sections.** §4 gains a constraint: changesets are the unit of
application, not authorship. If the format supports only hand-listed moves, it
inherits the same failure — it will produce reviewable one-off lists forever rather
than encoding the standing policy that generates them. This also strengthens §3.2's
case for moving pool assignment sooner, since a state machine cannot live in a
system that models only buckets.

**Also recorded:** the disabled TOH IDs and Relaunch Sweepers are old copy held
pending a retirement decision, not misconfiguration. Moved to §7 Resolved so the
next reader does not re-flag them as a bug.
