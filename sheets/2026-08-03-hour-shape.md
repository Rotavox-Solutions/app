# The hour is structurally short — shape variants, side by side

**2026-08-03.** Follow-on to `sheets/2026-08-02-hour-length.md`, which fixed the *generator*.
This is about the *shape*, which is where the deficit actually lives.

## The finding

PD direction, 2026-08-03: *"structural reliance upon F defeats the purpose; if F is a
near-constant appearance in the log, then F is no longer filler, and its presence
indicates a structural deficiency in the natural hour."*

Correct. Measured (`tools/hour-length.mjs`), the natural hour — every authored position at
its category's live mean, F excluded:

| clock | music pos | natural | short by | P(F fires) |
|---|---|---|---|---|
| ES | 16 | 55.58 | 4.42 | 97% |
| FF | 16 | 55.96 | 4.04 | 96% |
| HD | 16 | 56.01 | 3.99 | 95% |
| DNa | 15 | 56.63 | 3.37 | 85% |
| CO | 16 | 56.83 | 3.17 | 89% |
| DNb | 15 | 56.93 | 3.07 | 83% |
| WW | 16 | 57.56 | 2.44 | 82% |
| EM | 16 | 57.63 | 2.37 | 81% |
| WD | 16 | 58.42 | 1.58 | 71% |
| GHa/GHb | 15 | **60.18** | — | 48% |

**Station-wide: F is structurally required in 84% of hours.** The model predicts 84%; the
2026-08-03 approved log carried F in 19 of 24 hours (79%). It is calibrated.

### Cause

The clocks were authored on an assumed ~3:30 song. The library does not have one — it has
two, split by era:

| | mean | SD |
|---|---|---|
| A1 | 3:14 | 16s |
| Discovery / R2 / R3 / R1 / C / A2 | 3:07–3:28 | 28–38s |
| N / B | 3:35–3:38 | 31–38s |
| G2000 / G2010 | 3:51 | 46–53s |
| G1990 / H1 / H2 | 4:09–4:12 | 57–73s |

A clock's natural length is therefore a function of its **currents share**, and the deficit
orders exactly that way: ES carries 11 of 16 positions in currents and is shortest; Golden
Hour carries none, is all gold, and lands at 60.18 needing no help at all.

This also explains why the uniform "+1 position per clock" tried on 08-02 broke locks
(B 4d→1d, R3 56d→7d, C 11d→3d): it added slots to all eleven clocks including GH and WD,
which need none, inflating turnover everywhere to fix a deficit concentrated in six.

## The two variants

Both hold the **floor rule**: no category authored into a clock may go below 1 (PD
direction — Discovery sits at 1 in every daytime clock, and zeroing it leaves whole hours
with no Discovery). Both also refuse to reduce any **currents** position: trading an A1 out
of a peak clock buys 55 seconds and costs a third of that hour's power rotation. The
optimiser reaches for it every time otherwise, because it is the cheapest move on the
objective and the objective does not know what a peak hour is for.

### Variant `gold` — added length from the gold tiers

    ES  +G1990          FF  +2 G1990 −G2010    HD  +2 G1990 −G2010
    CO  +2 G2000 −G2010 WW  +G2010             WD  +G2010
    EM  +G2010          DNa +G2000 +G1990 −G2010
    DNb +2 G2000 −G2010 GHa/GHb  +G1990 −G2010

**F fires in 37% of hours.** Currents and recurrents solve unchanged — every target still
met. Gold re-solves:

| | target now | target under `gold` | have | net |
|---|---|---|---|---|
| G2010 | 148 | 131 | 166 | +35 |
| G2000 | 104 | 127 | 152 | +25 |
| G1990 | 155 | **235** | 187 | **−48** |

Total gold target 407 → 493 against 505 present, so it is nearly free *in aggregate* and
badly distributed: G1990 must grow 48 while G2010 and G2000 sit 60 over between them. Era
is a property of the song, so the surplus cannot be moved.

Partial relief without sourcing: G1990 has 250 rows, 187 enabled. Of the 63 disabled, 26
are duplicates of enabled titles (correctly disabled) and **25 are titles with no enabled
copy at all** — Alanis "You Oughta Know", Beastie Boys "Sabotage", Beck "Loser", Blur
"Song 2", Bush "Glycerine". Canon G1990. *Not yet established why they are disabled* — if
the prune-library orphan sweep disabled them they are absent from RadioDJ and re-enabling
achieves nothing. **Verify before counting on them.** Best case they cover 25 of the 48.

### Variant `recurrent` — added length from R1/R2/R3

    ES  +2 R2   FF  +R1   HD  +R1   CO  +2 R1 −R2
    WW  +R2     WD  +R2   EM  +R2   DNa +R1   DNb +R1

**F fires in 41% of hours.** Currents solve untouched. Gold untouched, all surplus.
Recurrents re-solve:

| | target now | target under `recurrent` | have | net |
|---|---|---|---|---|
| R1 | 30 | 50 | 40 | **−10** |
| R2 | 48 | 67 | 47 | **−20** |
| R3 | 72 | 72 | 72 | +0 |

R1 lock 18d→24d, R2 24d→34d; both turnovers stay in band.

### A variant that failed, and why it is worth recording

The first pass allowed the whole currents ladder as a length source. The optimiser bought
length with B — cheapest per position — taking B to **318 slots/wk, level with A1**. At
that point the solver could place neither N nor C beneath it: `none satisfies`, twice. The
pyramid had no solution.

Length is not worth a tier. Both surviving variants source length from outside the currents
ladder by construction, which is the only reliable way to keep this from recurring.

## The result neither variant reaches

**No shape makes both F and trims rare.** An hour is ~16 draws with SD 2.5–3.6 min, against
a song of ~3.5 min. Whole-song granularity cannot resolve finer than its own unit:

- author the mean at 60.0 → short half the time → F in ~50% of hours
- author high enough for F to be rare (≈+2.6 min, P≈15%) → a trim in ~85% of hours,
  averaging 2.6 min ≈ one gold track ≈ 168 gold plays/week never airing, or **19% of gold
  slots**, which invalidates the gold depth solve more thoroughly than F ever did

So the choice is *which* conditional mechanism is normal, not whether one is. Both variants
sit near the sensible middle: F drops from 84% to 37–41%, and — more to the point — when it
does fire it now covers well under a minute instead of 4.4, so one F closes the gap instead
of two or three.

Getting below that needs **sub-song granularity**, which is exactly PERFECT-HOUR rung 3
(cue-point trimming). This is the first hard number arguing for it: it is not a refinement,
it is the only mechanism that changes the floor.

Second lever, cheaper and available now: **the gold tail drives the variance.** 71 tracks
run over 5:00 — G2010 tops out at **10:15**, G1990 at 8:46. Gold SD is 46–73s against A1's
16s. Lower variance does not move P(F) at a mean of 60, but it lowers the overschedule
needed for any given P(F) — at SD 2.5 you need +2.1 min for P=20%, at SD 1.5 only +1.26.
Siting the long tail in GH/DN only, where the hour has room, would buy that. Not costed
here.

## What F actually is, and why it changes the answer

PD question, 2026-08-03: *what is F's composition — because whatever fraction of the time
F fires, we are adding a slot for that mix, and that is load-bearing on era exposure.*

F is **75 tracks of 2023-2025 alternative and active rock**. It belongs to no other
category — a disjoint pool. Blink-182 "One More Time", Green Day "One Eyed Bastard", Idles
"Gift Horse", Ghost "Lachryma", Geese "Cobra", Linkin Park "Up From The Bottom", 100 Gecs,
Amyl and the Sniffers, Killswitch Engage, Chevelle, Halestorm.

**F is not a spacer. It is a current-era category that nobody put in a clock**, and it is
airing 161 times a week — measured by `expectedFillerCount`, calibrated against the 08-03
log (model 0.96/hour, actual 1.08).

Discovery is likewise current-era emerging (Giovannie & The Hired Guns, Metric, Tetrarch,
Surfbort). So the honest era accounting, **by airtime rather than by slot** — a gold
position is 3:51-4:12 against a currents position's 3:07-3:38, so counting slots
understates gold by about a fifth of itself:

| | currents | Discovery | F | **current-era** | recurrents | gold+heritage |
|---|---|---|---|---|---|---|
| now | 41.0% | 5.2% | **5.3%** | **51.5%** | 18.3% | 30.2% |
| `gold` | 40.0% | 5.1% | 1.2% | 46.3% | 17.9% | **35.9%** |
| `recurrent` | 40.1% | 5.1% | 1.4% | 46.6% | 23.7% | 29.6% |
| `discovery` | 39.9% | **11.8%** | 1.0% | **52.7%** | 17.8% | **29.5%** |

Both original variants shed ~5 points of current-era, because fixing the shortness collapses
F's 5.3% and neither replaces it in kind. `gold` then spends that 5 points *again* on gold,
for a 5.7-point swing in era exposure — the largest change on the table, and invisible in
SHAPES, because half of it is the disappearance of a category that was never authored.

### Variant `discovery` — author what is already happening

    ES +2  FF +2  HD +2  CO +1  WW +1  WD +1  EM +1  DNa +1  DNb +1   (all Discovery)

**F fires in 33% of hours — the lowest of the three** — and era exposure is held exactly:
current-era 51.5% → 52.7%, gold 30.2% → 29.5%.

Depth: Discovery 37 → **82** (turnover 35.41h, in band; lock 20d → 28d, better). Currents,
recurrents and gold solve completely unchanged.

**And it is self-funding.** Discovery needs +45. F holds 75 tracks of exactly this material.
Move 45 to Discovery, leave 30 in F — which at 33 plays/week is 1.1 plays/song/week, ample
for a residual filler pool. **No sourcing at all.**

Which 45 is a PD call, not an arithmetic one: F mixes big-name album cuts (Blink-182, Green
Day, Linkin Park) with genuinely emerging material, and Discovery is currently the latter
throughout. The fold changes what Discovery *means* unless the split is chosen deliberately.

## Is the station CHR-light?

PD framing: *we aren't current-heavy per se, if anything we are CHR-light.* Correct against
CHR, but CHR is not the format. Typical music-airtime shares (my understanding of format
practice, not a sourced document — worth checking against a trade reference):

| format | currents | recurrent | gold |
|---|---|---|---|
| Mainstream CHR | 65-80% | 15-25% | 5-15% |
| Alternative / Modern Rock | 45-60% | 20-25% | 20-30% |
| Active Rock | 40-55% | 20-25% | 25-35% |
| Hot AC | 30-40% | 20-25% | 40-50% |
| AAA | 25-40% | — | heavy library |

At 51.5% / 18.3% / 30.2% The BOLT sits **mid-band on currents for Alt/Active, light on
recurrents, and at the top of the band on gold**. So: yes CHR-light, but that is the wrong
comparison — we are correctly placed for Alt/Active and gold-leaning within it. The
listening impression that "the mix leans gold" is corroborated by the number.

Two things sharpen it. Heritage (pre-1990, 2.6%) is outside the format's normal palette
entirely — deliberate, per value proposition 2, but it reads *older* to a sampler. And A1,
the power tier, is only **10.9% of airtime**; CHR runs its A-list at 25-30%. The station's
most identifying rotation is a tenth of what it plays.

## Cume phase — agree, with a sharper reason

Protecting currents clockshare in this phase is right, but not primarily because currents
build cume. Standard doctrine cuts the other way: samplers are converted by *familiarity*,
and gold is familiar. A sampler decides inside one to three songs.

The real exposure is **format coherence**. Someone who hears Alanis, then a 2025 Ghost
track, then AC/DC cannot tell what this station is, and incoherence costs cume faster than
currency level does. Currents share is the main lever on coherence, which is why protecting
it is correct — and why moving gold to 35.9% while heritage sits in the same clocks is the
specific thing to avoid.

Cost of being wrong is near zero right now, as noted: at most a handful of repeat listeners
over 1 min TSL. That argues for the choice that preserves optionality and matches the
stated format identity, not the one that is cheapest to source.

## Recommendation — `discovery`

Reversing my earlier call for `gold`, which was made before F's composition was known.

| | `gold` | `recurrent` | `discovery` |
|---|---|---|---|
| F fires | 37% | 41% | **33%** |
| current-era airtime | 46.3% | 46.6% | **52.7%** |
| gold+heritage | **35.9%** | 29.6% | 29.5% |
| currents ladder | untouched | untouched | untouched |
| sourcing | **+48 G1990** | **+10 R1, +20 R2** | **none — fold 45 of F** |

`discovery` wins on every axis that matters here: it holds era exposure where it is, needs
no sourcing, leaves every other category's solve untouched, and produces the lowest filler
rate. It is also the most honest description of the station — it does not change what airs,
it makes what already airs visible to the format.

Its cost is position count: ES/FF/HD go to 18 positions and run +1.8 to +2.3 long, because
Discovery is the shortest category in the library and it takes two to close a peak deficit.
That means a trim in most peak hours.

## Two defects found on the way

1. **`trimPriority` can violate the floor rule.** Priority is G1990 1, G2000 2, G2010 3,
   R3 4, Discovery 5. ES carries exactly one gold position (G2010), so the first trim in an
   ES hour takes ES to *zero gold*. The floor that shape authoring enforces is not enforced
   at trim time. Under `discovery`, ES trims most hours, so this stops being theoretical.
2. **H2 still reports `none satisfies`** under every variant, and has since before this
   work. Not diagnosed.

## Open, in order

1. Confirm `discovery`, and split F's 75 — which 45 move.
2. Fix the trim floor (defect 1) before shipping a shape that trims most peak hours.
3. Fix the inverted recurrent ladder (cascade R1→R2→R3→gold; no sourcing).
4. Re-run `depth-solver --variant discovery`, edit SHAPES, re-seed, then **`dry-run-log`
   twice** — after the changeset and after the shape edit.
5. Establish why 25 canon G1990 titles are disabled — no longer blocking, still worth knowing.
