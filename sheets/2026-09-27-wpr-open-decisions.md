# WPR Config — §9 open decisions, resolved

- **Date:** 2026-09-27
- **Status:** ✅ **APPLIED to Notion 2026-09-28** as Config §11, with §2.3 and reading rule 2 amended
  in place. Dates rebased to the 2026-10-04 week of review (no chart pull had run). Kept as the
  working record of the reasoning; **Notion §11 is now authoritative.**
- **Target:** Notion → *The BOLT — Playlist Refresh Config*
  (`https://app.notion.com/p/3c32302fd74181728a9ce17799ff11ab`)
- **Prior state:** §9 held 12 items; #2, #3, #8 closed, #9 mostly closed, #4 assigned to Claude.

> ✅ **Dates rebased 2026-09-28.** The Config was untouched since 2026-09-04, confirming **no chart
> pull had run.** The first WPR cycle is therefore: **pull Fri 2026-10-02 · review Sat 2026-10-03 ·
> week of review 2026-10-04** (full-N-turnover exception, all 18) **· supply measured through Fri
> 2026-10-16.**

---

## §9 — final state

| # | Decision | Resolution |
|---|---|---|
| 1 | Panel weights | ✅ per chart × per function, 0–3, + geography multiplier + 40% composite cap |
| 2 | Seat US airplay | ✅ closed 2026-08-21 — free-tier Mediabase reports |
| 3 | Cadence conflict | ✅ closed 2026-08-21 — option (b), Friday pull |
| 4 | Publication day/time | ⏳ Claude verifies at first pull — no PD input needed |
| 5 | Promote/demote thresholds | ✅ vacancy-driven, evidence-ranked, rank-expressible floors |
| 6 | Drop criteria | ✅ triggers + destination triage by tier reached |
| 7 | `I` category | ✅ flag, not pool — revisit inside a grid rebalance |
| 8 | Final Report location | ✅ closed 2026-08-21 — Notion |
| 9 | Artifact paths | ✅ `charts/YYYY-MM-DD/`, Final Report → Notion |
| 10 | US emphasis vs §2.3 | ✅ §2.3 rewritten + 15–25% measurable |
| 11 | ZN drain policy | ✅ 26-week residency, recall trigger, ~100 cap |
| 12 | Protocol text revision | ✅ approved — **backup required first** |

---

## #1 — Panel weights

Weight **per chart per function**, 0–3 (0 unused, 1 corroborating, 2 strong, 3 primary).
A chart good for adds is useless for demotes, so a single scalar per chart is the wrong shape.

| Chart | Add | Promote | Demote | Drop |
|---|---|---|---|---|
| **MB 7-Day** AR/ALT | 1 | **3** | **3** | **3** |
| **MB Spincrease** AR/ALT | 2 | **3** | 2 | 2 |
| **MB Taking Off!** AR/ALT | **3** | 2 | 0 | 0 |
| **MB Adds** AR/ALT | **3** | 1 | 0 | 0 |
| Radio Update NMM | 2 | 0 | 0 | 0 |
| Radio X (UK) | 2 | 1 | 1 | 1 |
| Triple J (AU) | 2 | 1 | 1 | 1 |
| RadioWave ALT/ROCK 100 | 2 | 1* | 1* | 1* |
| Official Charts R&M (UK) | 1 | 1* | 1* | 1* |
| Euro alt (DE/NL/Nordic) | 1 | 1* | 1* | 1* |
| AzuraCast | — | — | — | — (Phase 5; enters at 3 across the board) |

\* composite — see the cap below.

**Geography multiplier:** US ×1.0 · UK/AU ×0.7 · EU ×0.5.
**Exception:** for **I-candidate identification** the non-US rows weight ×1.0 — they are the only
sources that can see international strength at all.

**Evidence score**, per record per function:

    score_f = Σ over charts [ weight(chart, f) × geo(chart) × signal(chart, record) ]

`signal` is normalised rank position, or normalised delta for Spincrease. Rank candidates by score,
fill vacancies top-down (#5).

> 🔒 **Composite cap — 40%.** Total composite contribution may not exceed 40% of any placement
> score. A composite-only record then *mathematically cannot* clear a promote/demote/drop
> threshold on its own. This makes §1a rule 2 arithmetic rather than aspirational, and stops
> weighting from quietly overriding it.

**Weights remain uncalibrated.** Keep the per-chart accuracy log (§1a); recalibrate against
outcomes once the archive carries enough weeks.

---

## #5 — Promote / demote thresholds

**Vacancy-driven, evidence-ranked, and expressible in rank alone** — the free tier may not publish
spins, so no threshold may depend on them.

1. Compute vacancies = `DEPTH_TARGET − enabled depth`, **after** drops are applied.
2. Rank candidates by #1 evidence score.
3. Fill top-down, subject to the floors below.

### Promotion floors

| Move | Floor |
|---|---|
| → **A1** | top-10 on its format 7-Day, **or** top-20 with positive 4-week trajectory |
| → **A2** | top-20, **or** top-30 rising |
| → **B** | top-30, **or** appears on Spincrease this week |
| **N → ladder** | ≥2 archive observations **and** (charts on format 7-Day **or** Taking Off! **or** Adds traction) |

### Demotion triggers

- Negative 4-week trajectory **and** fell ≥8 positions over 4 weeks; **or**
- Exceeded **max dwell = 1.5 × residency**: **A1 6wk · A2 4.5wk · B 4.5wk · C 7.5wk**

### Guards

- **No minimum dwell.** Gate on ≥2 archive observations (§6a) — chart history does not reset on a rung change.
- **Depth within ±1 of target — hard.** Protects the weekly exposure rate.
- **Trailing 4-week mean flow within ±25% — soft.** Protects residency and lifetime exposure.
- **N exempt from the flow band** — its flow is fixed at 9/wk by the 2-week dwell rule.

### When the floors cannot fill a vacancy

Promote the highest-scoring available candidate anyway, and **state the floor miss in the row's
`reason`**. Depth's ±1 band is hard so the hole cannot be left — but the compromise must be
visible, never silent.

---

## #6 — Drop criteria

| Trigger | Destination |
|---|---|
| `fell_off` its format 7-Day **2 consecutive weeks** and past tier residency | by tier reached ↓ |
| Exceeded **2× tier residency** with negative trajectory | by tier reached ↓ |
| **N:** hit 2-week max dwell, never charted, no Taking Off! / Adds traction | **ZN** |
| Texture / format fit — PD judgment | as PD directs, **written down** (§1a rule 5) |
| Composite evidence alone | ❌ **not a valid drop** (§1a rule 2) |

**`fell_off` requires two consecutive weeks.** One week's absence is often a chart-boundary
artifact, and §7b's phantom-`fell_off` risk means a single-week trigger would fire on
unreconciled aliases.

### Destination triage — by how high the record climbed

| Reached | Destination | Approx volume |
|---|---|---|
| A1 or A2 | **R1** | ~1.2/wk *(R1 absorbs 30 ÷ 26 = 1.15/wk)* |
| B or C only | **W (bench)** | ~4/wk |
| Never charted, retired from N | **ZN** | ~4.3/wk |

> ⚠️ **State the uncomfortable part plainly.** At 9 adds/week against recurrent pools sized for
> ~1/week, **most currents exits go to bench, not to recurrents.** "Drop" mostly means bench, and
> R1 is a narrow privilege rather than the default exit. That is arithmetic, not a policy failure.
> If it is wrong, the thing to revisit is **recurrent depth**, not the drop rule.

---

## #7 — `I` (International): build the flag, not the pool

**Do not create the category.** `FORMAT-WORKFLOW.md` §1a.5: *"if a distinction is directional it is
a state, not a pool."* International strength is an **attribute of a record** — it does not say how
often to play it, which is the only thing a pool encodes.

Two hard reasons, both now evidenced:

1. **§6a showed the currents ladder is tightly bound by the pyramid ratio.** A sixth currents pool
   would break it the same way N=25 did.
2. **A pool needs slots** — the identical +50%-inventory problem that blocked N=25.

**Instead:** carry `international: true` as an annotation in the archive (§7a) and in the changeset.
International records enter through N/B/C like anything else, so they **air now at zero structural
cost**, and the flagged set accumulates as evidence.

**Revised trigger:** ≥12 flagged records **and** a grid rebalance already underway. Evaluate `I`
*inside* the N=19/N=25 scenario work — both draw slots from the same budget, and deciding them
separately means deciding them twice.

---

## #10 — §2.3 rewrite, with a measurable

Replace §2.3 with:

> **3. Deliberate deviation from US airplay charts.** The US is the primary market and the panel is
> deepest there — US airplay is the best-measured evidence available and is weighted accordingly.
> But **evidence quality is not editorial obedience.** The station is distributed worldwide, and a
> playlist mirroring US airplay has no reason to be chosen over the US stations that *are* those
> charts. **Deepen the US evidence; still deviate in the calls.** Deviation is expressed as
> (a) pre-1990 seasoning, (b) non-US records that never chart in the US, (c) earlier entry than US
> airplay would justify. Each is recorded, never assumed.

**Measurable: 15–25% of currents carry no US airplay justification.** At 73 currents that is
**11–18 records**.

§7b makes it computable rather than a judgment call: records holding an `rdj_song_id` with **no US
airplay appearance anywhere in the archive**. Report the figure in every Final Report.

This turns §2.3 from a value into a number — addressing the failure the repo already names about
its own value propositions, that they get *"applied invisibly."*

---

## #11 — ZN drain policy

At ~3.8 retirements/week, ZN would grow ~200/year unchecked. The 148-song rest pool is the recorded
precedent.

| Rule | Value |
|---|---|
| **ZN residency** | **26 weeks**, then auto-bench to W |
| **Recall trigger** | Re-appears on a format 7-Day or Taking Off! while in ZN → return to N *(or direct to B if strong)* |
| **Depth cap** | **120.** Above it, force the oldest out |

**The recall trigger is the whole reason ZN exists rather than W** — it is the "we were early" case,
and without it ZN is just a slower bench.

> 📐 **Corrected 2026-09-28.** The ZN rate is 9.0 in − 4.7 promoted to B = **4.3/wk**, not the 3.8
> estimated earlier, so 26 weeks gives **≈112** — inside a 120 cap and still well under the 148
> pathology. §6's older "~5.5 to ZN" figure predates the depth-18 ladder.

---

## #12 — Protocol text revision

**Current (stale):** *"Aim to turnover the N category entirely every 1–2 weeks."*
Written when N was **8 enabled**; at depth 18 it would demand 9–18/week.

**Replacement:** *"N carries a 2-week maximum dwell; at depth 18 that is ~9 records per week."*

### Procedure — required by the protocol's own revision policy

1. **Duplicate** the protocol page.
2. **Rename the copy** `Weekly Playlist Refresh protocol — backup YYYY-MM-DD` (timestamped).
3. **Then** edit the original.
4. Note the revision date in the protocol body.

**Do not skip step 1–2.** The backup is part of the policy, not a courtesy.

---

## Revision-log entry to add

| Date | Change | Approved by |
|---|---|---|
| 2026-09-27 | **All seven remaining §9 items resolved.** #1 panel weights (per chart × function, geo multiplier, 40% composite cap). #5 thresholds (vacancy-driven, rank-expressible floors, depth ±1 hard / flow ±25% soft). #6 drop criteria + destination triage by tier reached. #7 `I` as a flag, not a pool. #10 §2.3 rewritten with a 15–25% non-US-justified currents measurable. #11 ZN drain (26wk, recall trigger, ~100 cap). #12 protocol text revision approved, pending timestamped backup. | PD/MD |
