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

## Recommendation

`gold`, on three grounds:

1. **It dilutes the peak less, counter-intuitively.** Gold is the long end, so it closes the
   deficit in fewer positions. ES currents share by position: 69% now → 65% under `gold` →
   61% under `recurrent`, which needs two added positions where gold needs one.
2. **The sourcing is chart-independent.** 48 tracks of 1990s catalog is a shopping list.
   30 recurrents is chart archaeology against a station six weeks old.
3. **It leaves the recurrent ladder free to be fixed on its own terms** — and it needs
   fixing: R1 is at 40 against a target of 30, so R1 turns over in 44.2h against R2's 43.4h.
   R1 is currently *slower* than R2. The ladder is inverted, and `recurrent` would raise
   both targets on top of an already-broken relationship.

Against it: more gold in the peak clocks is a real texture change, and that is a PD call,
not an arithmetic one.

## Open, in order

1. Decide the variant.
2. Establish why 25 canon G1990 titles are disabled — sets the true sourcing number.
3. Fix the inverted recurrent ladder (cascade R1→R2→R3→gold; no sourcing).
4. Re-run `depth-solver --variant <x>`, edit SHAPES, re-seed, then **`dry-run-log` twice** —
   after the changeset and after the shape edit.
