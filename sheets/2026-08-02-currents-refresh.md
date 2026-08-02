# Currents refresh — week of 2026-08-02

Third and final draft. Drafts 1–2 were built on a composite chart; both got calls wrong
that real airplay overturned. See "What the earlier drafts got wrong" at the end — the
failure mode is methodological and will recur.

## Key — category ↔ RadioDJ subcategory ID

The changeset moves records by numeric `id_subcat`. This is what those numbers mean.

| Category | Subcat | | Category | Subcat |
|---|---|---|---|---|
| **A1** | **4** | | R1 | 24 |
| **A2** | **2** | | R2 | 25 |
| **B** | **1** | | R3 | 26 |
| **C** | **3** | | Discovery (X) | 6 |
| **N** | **23** | | W (bench) | 36 |
| | | | Z (rested) | 38 |
| G2010 | 29 | | ZN (rested from N) | 39 |
| G2000 | 28 | | F (filler) | 31 |
| G1990 | 27 | | GDEEP | 37 |
| H1 | 30 | | *B2 — retired* | *5* |
| H2 | 49 | | | |

The IDs are not in ladder order — subcat 1 is B, 2 is A2, 3 is C, 4 is A1. Read the
table, not the number.

**B was two pools and is now one.** The M4 clock model has a single B
(`CUR = ["A1","A2","B","C","N"]` in `tools/m4-format.mjs`), so B1 and B2 mapping to one
category was indirection with no consumer. **B is subcat 1**; subcat 5 is retired
indefinitely — emptied rather than deleted, because RadioDJ history and playlist rows
may reference it.

## Charts of record

| Chart | Authoritative for | Measures | Week |
|---|---|---|---|
| **Mediabase Active Rock**, All Stations US, Currents Only | rock records | **airplay (spins)** | Jul 19–25 |
| **Mediabase Alternative**, All Stations US, Currents Only | alternative records | **airplay (spins)** | Jul 19–25 |
| RadioWave ALT/ROCK 100 | *entry signal only* | composite (streaming + sales + airplay) | Jul 26 |

**A record is read on the airplay chart its format lives on.** Composite charts are used
only as a **leading indicator for N** — consumption precedes airplay, so a composite says
what to *enter*, never what to *promote or drop*.

Both Mediabase charts require an AllAccess account and publish Tuesday afternoon under
Mediabase policy; they cannot be pulled programmatically.

- **Targets:** A1 10 · A2 11 · B 14 · N 17 · C 20 = **72**
- **Present (enabled):** A1 7 · A2 10 · B 19 · C 21 · N 8 = **65**

**All three charts measure the United States.** See the next section — this is a
structural limitation of the research, not a footnote.

---

## Value propositions as programming inputs

The charts are an input, not the objective function. The station's stated value
propositions constrain how far they may be followed:

1. **The hybrid.** A light-CHR current intensity over a combined Active Rock ×
   Alternative vein — an uncommon variant, not either parent format.
2. **Pre-1990 inclusion.** H1 (alt canon) and H2 (pre-1980), which no chart rewards.
3. **Deliberate deviation from US airplay charts**, as a function of internet radio's
   global reach.

**There is no TSL at risk.** The station is in accumulation mode with effectively no
repeat listeners (~80% of connections abort inside a minute). Deviating from chart
orthodoxy cannot alienate an audience that does not yet exist. The risk runs the other
way: a playlist that mirrors US airplay has no reason to be chosen over the US stations
that *are* those charts.

### The geographic gap — a real oversight

The format grid was derived from a weighted **global** audience matrix, and its blocks are
named for it: **Eastern Sunrise, Continental, European Morning, Full Footprint**. The
station has already decided its audience is not American.

Every chart in this sheet is US-only. Those two facts contradict each other. No UK,
European or Australian source was consulted, and that is a structural gap in the research,
not a matter of thoroughness.

Concretely, it changes calls:

| Record | US airplay | Under a global lens |
|---|---|---|
| **Sleep Token — Emergence** | nc | British; enormous in the UK. **Exit reversed.** |
| **Muse — Be With You** | nc | British; a European arena act. **Hold confirmed.** |
| **Sam Fender — Rein Me In** | ALT #24 | UK superstar. His US position **understates** him most of any record here. |
| **Myles Smith — Hold Me In The Dark** | ALT #17 | British. Pop-leaning, but not a US-taste import. |
| Noah Kahan — Doors | ALT #11 | American folk-pop. US-centric; the **weakest** of the four on this axis despite the best US position. |
| Dominic Fike — Babydoll | ALT #18 | American alt-pop. |

The geographic lens **reorders the four AAA-leaning records** and does not merely soften
them. Sam Fender rises; Noah Kahan falls. That ordering is invisible to US charts.

### Proposed chart panel

The weighting model needs a third axis — **format × measurement type × geography**.
Sources worth adding, none yet consulted:

- **Official Charts Company (UK)** — Rock & Metal, and the singles chart
- **BBC Radio 1 / Radio X / Kerrang! playlists** — Radio X is the closest UK analogue to
  the hybrid, and playlist adds are a direct airplay signal
- **Triple J (Australia)** — arguably the single best format match anywhere: alternative
  with rock lean and high current intensity, English-native
- **German / Dutch / Nordic alternative charts** — the Continental block is programmed for
  this audience and nothing currently informs it

### The chart that will eventually outrank all of them

**AzuraCast listener behaviour is the only source that measures *this* station's
audience.** External charts are a prior; session-length and skip data are the posterior.
As weeks of behavioural data accumulate, the external panel should be progressively
down-weighted rather than permanently trusted. That is Phase 5 instrumentation, already
pending.

---

## Finding 1 — this is a recall problem, not an acquisition problem

Sweeping all three charts against the library: **every charting record worth having is
already owned**, except two. They sit in W (bench), ZN (rested), Rx, X and — in one case —
gold.

The refresh needs **17 entries and 11 exits**, plus one bug fix. **Sixteen of the
seventeen entries are recalls**; the seventeenth is misfiled, not missing.

Only **two** records are genuinely absent from the library, both rock:

| Record | Active Rock | Note |
|---|---|---|
| **Nickelback — Rattle The Cage f/John 5** | **#17, +444** | **largest single-week gain on either chart** |
| Marilyn Manson — Exit Wound | #24, +39 | rising |

## Finding 2 — a top-25 Active Rock record is disabled

**Ryan Perdz — "Sour" is in C with `enabled = 0`** while sitting at **AR #21 and rising**
(+67). The engine filters on `enabled`, so C's effective depth is 21, not 22, and this
record has been unschedulable for its entire climb. One-line fix, not a music decision.

## Finding 3 — the misplacements that are real

Most "odd" placements encoded airplay correctly. These five did not:

| Record | Airplay | Where it is | Problem |
|---|---|---|---|
| **Julia Wolf — In My Room** | **ALT #3 ↑ +237** | **R3** | 104-week residency tier. A top-3 record paced like old catalogue. |
| **Buffalo Traffic Jam — Fool's Gold** | **ALT #12 ↑ +100** | **W** | benched; absent from the composite entirely, so nothing but the airplay chart would have surfaced it |
| **Dominic Fike — Babydoll** | **ALT #18 ↑ +75** | **G2010** | a live 2026 alternative current filed in 2010s gold |
| **Poppy — Time Will Tell** | **AR #20 ↑** | **W** | benched while charting |
| **From Ashes To New — Die For You** | **AR #23, +219** | **W** | benched; third-largest gain on Active Rock |

---

## Proposed moves

Sourcing runs N-first. **One exception**: Julia Wolf at ALT #3, misfiled to R3. Routing a
top-3 airplay record through a 5-week N residency costs weeks and buys nothing.

### A1 → 10 — the top five of each chart

| | Record | Airplay | Move |
|---|---|---|---|
| 1 | Temper City — Self Aware | ALT #1 ↑ 3182 | hold |
| 2 | Death Cab For Cutie — Riptides | ALT #2 ↑ +212 | A2 → A1 |
| 3 | Julia Wolf — In My Room | ALT #3 ↑ +237 | **R3 → A1** (exception) |
| 4 | Cage The Elephant — Beaches In Tennessee | **ALT #4 ↑ +299** | **N → A1** |
| 5 | Dexter And The Moonrocks — Freakin' Out | ALT #5 −83 | hold |
| 6 | Breaking Benjamin — Something Wicked | AR #1 ↑ +140 | hold |
| 7 | Five Finger Death Punch — Eye Of The Storm | AR #2 −135 | hold |
| 8 | Three Days Grace — Don't Wanna Go Home Tonight | AR #3 **−401** | hold — watch |
| 9 | Architects — Broken Mirror | AR #4 ↑ +51 | hold |
| 10 | The Warning — Kerosene | AR #5 ↑ +168 | B1 → A1 |

**Out of A1: In Color — "Headlights" → A2.** It fell from ALT #6 to **#10 on −499 spins** —
the second-steepest decline on either chart. This is the demotion you predicted A1 would
need.

**In: 4 · Out: 1 · Net +3** — exactly the original scope.

Cage The Elephant is the largest gainer on the alternative chart (+299) and was sitting in
N. It skips to A1 on merit, not as an exception to the N-first rule — N is where it was,
and the chart says A1.

**Worth adopting as a standing rule: A1 = the top five of each chart.** It is symmetric,
defensible, self-maintaining, and it produced a 5/5 alt/rock split without anyone
arguing about format positioning.

### A2 → 11

**Out:** Death Cab → A1 · **Black Label Society → B** (AR #9, **−342**, third-steepest fall)

**In:** In Color (A1↓, ALT #10) · The Strokes — Going Shopping (ALT #6 ↑, B1↑) ·
Modest Mouse — Picking Dragons' Pockets (ALT #7 ↑ +99, B1↑)

Roster: A Perfect Circle (AR #7 ↑ +162) · Beartooth (AR #6) · Dayseeker (nc) · Dirty Heads
(ALT #8, **−601**) · Eva Under Fire (AR #8) · In Color (ALT #10, −499) · Modest Mouse (ALT
#7 ↑) · Role Model (nc) · sombr — Back To Friends (nc) · The Strokes (ALT #6 ↑) · Sublime
— Until The Sun Explodes (ALT #9)

**Dirty Heads fell 601 spins — the steepest decline on either chart** (ALT #3 → #8). Draft
2 held it out of A1 on texture grounds (two reggae-rock records at 4.5 plays/day would
collide). That was right for the wrong reason; the data now says the same thing, harder.
It is the next A2 demotion if it falls again.

*Flagged:* Dayseeker and Role Model chart nowhere on airplay. **sombr "Back To Friends"
also charts nowhere on Mediabase Alternative** despite composite #18 — sombr is a
streaming act whose airplay does not match its consumption. Worth revisiting whether it
merits A2.

### B → 14

**Out to A1:** The Warning · **Out to A2:** The Strokes, Modest Mouse
**In from A2:** Black Label Society · **In from C:** Joyce Manor (ALT #16 ↑) ·
**In from N:** Shinedown — Young Again (AR #10 ↑ +102)

**Exits to R1 (5):** Shinedown — Dance, Kid, Dance (nc) · sombr — Undressed (nc) ·
Foo Fighters — Today's Song (superseded by "Caught In The Echo") · Deftones — My Mind Is A
Mountain (nc) · Sleep Theory — Words Are Worthless (nc)

**Sleep Token and Muse are explicitly *not* exited**, though both chart nowhere on US
Mediabase. Both are British acts whose US alternative airplay materially understates their
standing in the station's actual footprint. Dropping them on US airplay alone is precisely
the error value proposition #3 exists to prevent — see "Value propositions as programming
inputs" above. Sleep Theory (Memphis, nc on both charts) takes the exit slot instead.

Roster: Atreyu (AR #12) · Bad Omens (ALT #13 ↑) · Bilmuri & ADTR (AR #18 ↑) · Black Label
Society (AR #9) · Evanescence — Who Will You Follow (AR #14 / ALT #23) · Greta Van Fleet
(AR #13) · Joyce Manor (ALT #16 ↑) · Muse (nc) · Papa Roach — See U In Hell (AR #16 ↑) ·
Shinedown — Young Again (AR #10 ↑) · Sleep Theory (nc) · sombr — Homewrecker (nc) ·
The HU — Lost Soul (AR #19) · The Pretty Reckless (AR #25)

### C → 20

**Fix:** enable Ryan Perdz — "Sour" (AR #21 ↑)

**Out:** Joyce Manor → B

**Exits to R1 (5):** Shinedown — Three Six Five (nc) · Shinedown — Safe And Sound (nc) ·
sombr — 12 To (nc) · Cage The Elephant — Metaverse (superseded) · MGK, Fred Durst — FIX UR
FACE (nc)

**In from N (4):** Almost Monday — No More Regrets (ALT #14 ↑) · Weezer — We Might As Well
Be Strangers (ALT #15 ↑ +182) · Phoebe Bridgers — Lost Boys (ALT #25 ↑ +95) ·
Motionless In White — R.I.P. (AR #22 ↑ +134)

Autumn Kings (AR #11 ↑), Tim Montana (AR #15), Beabadoobee (ALT #19 ↑) and M.O.T.H.E.R.
(ALT #20 ↑) hold in C. Autumn Kings is the first promotion if it keeps climbing.

### N → 17

**Retires from N (1):** Nine Inch Nails, Boys Noize — Closer (Nine Inch Noize Version).
Charts nowhere; a remix of a 1994 record has no promotion path. → R1.

**Holds (1):** U2 — Street Of Dreams

**16 recalls — all already owned.** Tier A is airplay-charting; tier B is composite-only,
which is the correct use of a composite: an entry signal.

**A — charting on Mediabase airplay (9):**

| Record | Airplay | From |
|---|---|---|
| **Noah Kahan — Doors** | ALT #11 ↑ +120 | W |
| **Buffalo Traffic Jam — Fool's Gold** | ALT #12 ↑ +100 | W |
| **Myles Smith — Hold Me In The Dark** | ALT #17 ↑ +75 | W |
| **Dominic Fike — Babydoll** | ALT #18 ↑ +75 | **G2010** |
| **Edgehill — Love To Go** | ALT #21 ↑ +109 | W |
| **The Neighbourhood — Private** | ALT #22 −29 | W |
| **Sam Fender, Olivia Dean — Rein Me In** | ALT #24 ↑ +30 | W |
| **Poppy — Time Will Tell** | AR #20 ↑ | W |
| **From Ashes To New — Die For You** | AR #23, +219 | W |

**B — composite-only, entry signal (7):**

| Record | Composite | From |
|---|---|---|
| Young The Giant — Different Kind Of Love | #29 | R2 |
| Cannons — Starlight | #31 | W |
| Yellowcard, Good Charlotte — Bedroom Posters | #32 | ZN |
| Clarion — Hello Juliet | #33 | X |
| Violet Grohl — Thum | #38 | W |
| Twenty One Pilots — Drag Path | #39 | R1 |
| Social Distortion — Born To Kill | #40 | W |

No artist here collides with the post-move currents roster.

**Note: draft 2 picked the wrong Edgehill record.** "Doubletake" (in Z) was composite #15;
the record actually getting airplay is **"Love To Go" (in W), ALT #21 and rising**. The
composite and the airplay chart disagree on which single is working. Airplay wins.

---

## The one decision I will not make for you

**Four of the nine airplay-charting recalls are AAA / pop-alt in texture** — Noah Kahan
(#11), Myles Smith (#17), Dominic Fike (#18), Sam Fender (#24). Drafts 1 and 2 excluded
all four on the grounds that they are the wrong texture for New Rock.

All four are top-25 **US alternative airplay** — definitionally what American alternative
radio is playing this week. On US data alone the exclusion does not survive.

But **US airplay is authoritative about the US market, which is not this station's
market**, and following it is not free: value proposition #1 is the hybrid, and four
AAA-leaning records in a 17-song N pool is roughly a quarter of the entry tier. Value
proposition #3 exists precisely so that this trade is a choice rather than a default.

Applying the geographic lens reorders them — and the reordering is the useful part:

| | US airplay | Global standing | Net |
|---|---|---|---|
| **Sam Fender — Rein Me In** | #24 (worst) | **UK superstar** | **strongest case** |
| Myles Smith — Hold Me In The Dark | #17 | British | moderate |
| Dominic Fike — Babydoll | #18 | US alt-pop | weak |
| Noah Kahan — Doors | #11 (best) | US folk-pop | **weakest case** |

**The US chart ranks these four in almost exactly the reverse order of their fit for a
globally-distributed station.** That inversion is the strongest single argument in this
sheet for the chart panel proposed above.

**This is positioning, and it is yours.** The options:

1. **Take all four** — follow US airplay, accept the softening of the hybrid.
2. **Take none** — hold the rock lean; replace with the next four owned composite records
   (All-American Rejects, The Last Dinner Party, Metric, **Nothing But Thieves** — the
   last three all British, which is a point in favour under value proposition #3).
3. **Take Sam Fender and Myles Smith** — the two British records. Keeps the hybrid mostly
   intact, serves the European Morning and Continental blocks, and drops the two records
   whose case rests entirely on the US chart.

**I would take option 3**, and I am changing my recommendation from the previous draft to
say so. Option 1 was written when US airplay was the only lens; it optimises for a market
the station does not primarily serve. Option 3 follows airplay *and* the value
propositions, and it is the only one of the three that improves the station's footprint
fit rather than merely trading texture for chart conformity.

The sheet's N list still shows all four — swap Kahan and Fike for two of the option-2
substitutes to execute option 3.

---

## Arithmetic check

| | A1 | A2 | B | C | N | total |
|---|---|---|---|---|---|---|
| present (enabled) | 7 | 10 | 19 | 21 | 8 | 65 |
| **target** | **10** | **11** | **14** | **20** | **17** | **72** |

- Entries to currents: **17** (16 N recalls + Julia Wolf → A1)
- Exits to R1: **11** (5 from B, 5 from C, 1 retired from N)
- Re-enabled: **1** (Ryan Perdz)
- 65 + 17 − 11 + 1 = **72** ✓

## Duplicate-artist load

| Artist | Before | After |
|---|---|---|
| Shinedown | 4 | 1 |
| sombr | 4 | 2 |
| Cage The Elephant | 2 | 1 |
| Noah Kahan | 0 in currents | 1 (6 elsewhere in library) |
| Evanescence | 2 | 2 |
| Sublime | 2 | 2 |

Evanescence "Afterlife" (C, charts nowhere) is the next C exit if room is needed.

---

## Data hygiene found during the sweep

1. **`Falling In Reverse, Marilyn Mansion` — artist tag misspelled** ("Mansion"). Artist
   separation matches on the tag, so it will not match Marilyn Manson. Matters now:
   Manson "Exit Wound" is a proposed acquisition.
2. **Ryan Perdz "Sour" is `enabled = 0`** at AR #21 — Finding 2.
3. **Dominic Fike "Babydoll" (ALT #18, charting now) is in G2010.**
4. **Julia Wolf "In My Room" (ALT #3) is in R3.**
5. **Violet Grohl "Thum" exists twice** — W as "Thum", ZN as "THUM".
6. **Sevendust filed as "Unbreakable Motor"** in R1; chart entry is "Unbreakable".
   Probable tag corruption.
7. **Post Sex Nachos "SOS" cased "Sos"** in X.
8. **ZN holds 12 charting records.** Rest has an entrance and no exit — the accumulation
   failure already in the glossary. Mechanism gap, not data error; ADR-0001 §3.7.
9. **X (Discovery) holds proven records** — Clarion (composite #33), Metric (#51).
   Whether Discovery needs an automatic exit-on-chart rule is a design question.

## What the earlier drafts got wrong

Recorded because the failure is methodological.

Draft 1 read every record on the RadioWave composite. It *named* the composite's rock bias
in its own caveat section, then let that chart drive recommendations anyway. Draft 2 fixed
the rock side but kept the composite for alternative.

| Call | Composite said | Airplay says | Verdict |
|---|---|---|---|
| Architects → demote from A1 ("the clearest single error") | #94 | **AR #4, rising** | wrong |
| Atreyu → exit to R1 | #99 | **AR #12** | wrong |
| The HU — Lost Soul → exit to R1 | nc | **AR #19** | wrong |
| Nickelback → excluded as "Classic Hits drift" | #76 | **AR #17, +444** | wrong |
| Cage The Elephant → A2 | #8 | **ALT #4, +299** | too low |
| In Color → hold in A1 | #5 | **ALT #10, −499** | missed a demotion |
| Edgehill "Doubletake" | #15 | **"Love To Go" is the airplay record** | wrong single |
| Buffalo Traffic Jam | absent | **ALT #12, rising** | missed entirely |
| Noah Kahan / Myles Smith / Fike / Fender → excluded on texture | #11–#27 | **ALT #11–#24** | taste over data |
| Three Days Grace → demote | #66 | AR #3, −401 | right, wrong reason |

**Rules going forward:**

1. **No record may be promoted, demoted or dropped on a composite chart.** Placement
   requires a Mediabase airplay position on the chart matching its format.
2. **Composites are an entry signal only** — they surface candidates for N. Consumption
   leads airplay, which is exactly why Buffalo Traffic Jam was invisible to it and why
   Julia Wolf at ALT #3 was invisible to us.
3. **Texture exclusions must be stated and surfaced, never applied silently.** Four times
   in this exercise a taste judgment was applied invisibly and later overturned. The
   error was not that the judgment existed — value proposition #1 makes texture a
   legitimate input — it was that it was never written down where it could be weighed
   against the charts.
4. **A US chart position is evidence about the US market only.** For a station whose own
   daypart grid is built on a global audience matrix, US airplay is one panel among
   several, and currently the only one consulted. Absence from a US chart is not evidence
   of absence — see Sleep Token and Muse.

The library's "odd" placements were mostly not odd. Architects in A1, Atreyu and The HU in
B, Black Label Society in A2 — all correct against real airplay. The pool assignments
encoded knowledge the composite does not carry.

## Open questions for the PD

1. **The four AAA-leaning recalls** — recommendation is **option 3**, take Sam Fender and
   Myles Smith only. See "The one decision I will not make for you".
2. **Commission the non-US chart panel.** Radio X, Triple J and the UK Rock & Metal chart
   are the three highest-value additions; the Continental block currently has nothing
   informing it at all.
2. **Three Days Grace** — hold on 2672 spins, or demote now on −401?
3. **Nickelback and Marilyn Manson need sourcing.** Nickelback especially: +444.
4. **sombr may be over-weighted** — three currents, none charting on Mediabase Alternative.
5. **Nothing is committed.** No changeset written.
