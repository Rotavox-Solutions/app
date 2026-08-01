# Daypart Analysis — hour-by-hour audience priority matrix

- **Date:** 2026-08-01
- **Station:** The BOLT (CLUBFM), anchored `America/Los_Angeles`
- **Tool:** `tools/daypart-matrix.mjs` (re-run after changing any assumption)
- **Supersedes the daypart reasoning in:** M3 seed (`packages/schema/seed/m3-clubfm-seed.sql`)

Replaces inherited broadcast daypart names with a per-hour resolution of *who is
plausibly listening*, then clusters the 168 cells into blocks named for what they are.

---

## 1. Method

For each of the 168 weekly cells, every region's local hour is resolved, multiplied by
a listening-propensity curve and an audience-share weight, and summed into an index
normalized to the week's peak. Each region-hour is also classified by session
character — morning, long/desk, afternoon, evening, dead — and the weighted mix
determines the hour's programming orientation.

### Regions and weights

| Region | UTC (summer) | Share |
|---|---|---|
| US Eastern | −4 | 0.33 |
| US Central | −5 | 0.20 |
| US Pacific *(home)* | −7 | 0.14 |
| US Mountain | −6 | 0.05 |
| Central Europe | +2 | 0.16 |
| UK / Ireland | +1 | 0.12 |

US 0.72 / Europe 0.28, per observed traffic skew.

### What is fact and what is assumption

**Fact:** the timezone arithmetic, and therefore which regions are simultaneously in
active hours for any given cell. This is what drives the ranking of hours.

**Assumption:** the propensity curves. They are desk-listening shaped — peaking
10:00–15:00 local rather than at commute times — because internet listening skews to
long work-hours sessions rather than in-car drive time. Weekend curves are flatter and
later; Friday evening is held slightly higher.

**Why the conclusions survive the assumption:** the index is dominated by *how many
weighted regions are awake at once*, not by curve detail. 12:00 PT scores high because
it is simultaneously Pacific noon, Eastern 15:00, and Central European 21:00 — three
populated regions in active hours. 21:00 PT scores low because only Pacific is awake.
No plausible reshaping of the curves inverts that. The **thresholds** between
orientations are soft; the **ordering** of hours is robust.

---

## 2. Weekday result (Mon–Thu; Friday differs only after 17:00)

| PT | ET | CE | Index | Orientation | M3 daypart | M3 currents% |
|---|---|---|---|---|---|---|
| 00 | 03 | 09 | 31 | DEEP GOLD | Overnight | 13 |
| 01 | 04 | 10 | 35 | BALANCED | Overnight | 13 |
| 02 | 05 | 11 | 38 | BALANCED-TSL | Overnight | 13 |
| 03 | 06 | 12 | 44 | BALANCED-TSL | Overnight | 13 |
| 04 | 07 | 13 | 56 | BALANCED | Overnight | 13 |
| 05 | 08 | 14 | 71 | **CURRENT-FORWARD** | Overnight | **13** |
| 06 | 09 | 15 | 85 | CURRENT-FORWARD | AM Drive | 50 |
| 07 | 10 | 16 | 95 | CURRENT-FORWARD | AM Drive | 50 |
| 08 | 11 | 17 | **100** | BALANCED-TSL | AM Drive | 50 |
| 09 | 12 | 18 | 98 | BALANCED-TSL | AM Drive | 50 |
| 10 | 13 | 19 | 97 | BALANCED-TSL | Midday | 44 |
| 11 | 14 | 20 | 96 | BALANCED-TSL | Midday | 44 |
| 12 | 15 | 21 | **93** | BALANCED-TSL | **Gold Lunch** | **0** |
| 13 | 16 | 22 | 88 | BALANCED-TSL | Midday | 44 |
| 14 | 17 | 23 | 78 | CURRENT-FORWARD | Midday | 44 |
| 15 | 18 | 00 | 66 | CURRENT-FORWARD | PM Drive | 56 |
| 16 | 19 | 01 | 58 | CURRENT-FORWARD | PM Drive | 56 |
| 17 | 20 | 02 | 52 | GOLD-LEAN | PM Drive | 56 |
| 18 | 21 | 03 | 48 | GOLD-LEAN | PM Drive | 56 |
| 19 | 22 | 04 | 42 | GOLD-LEAN | Evening | 25 |
| 20 | 23 | 05 | 34 | GOLD-LEAN | Evening | 25 |
| 21 | 00 | 06 | 27 | DEEP GOLD | Evening | 25 |
| 22 | 01 | 07 | 26 | DEEP GOLD | Evening | 25 |
| 23 | 02 | 08 | 28 | DEEP GOLD | Evening | 25 |

---

## 3. Misalignments with M3, ranked

**1. Gold Lunch runs 93% gold during a 93-index hour.** 12:00 PT is Eastern 15:00 and
Central European 21:00 — the third-highest hour of the week — and it is the single most
gold-saturated cell in the schedule. This is the worst cell in the grid.

**2. Hours 04–05 PT are treated as dead and are not.** 05:00 PT scores 71 and resolves
CURRENT-FORWARD: Eastern 08:00 and Central Europe 14:00. It currently sits inside
Overnight at 13% currents. 04:00 PT scores 56 under the same treatment.

**3. PM Drive is over-invested.** It carries the highest currents share in the format
(56%) across an index falling 66 → 48. Meanwhile 05–07 PT (index 71–95) gets 13–50%.
Effort is being spent where the audience is leaving.

**4. The peak is 07:00–13:00 PT, not 06:00–10:00.** M3's AM Drive catches the rising
edge but hands off to Midday and Gold Lunch precisely at the top.

**5. Evening is correctly cheap.** 19:00–23:00 PT genuinely is single-region. M3's
25% currents there is defensible — this is the one block to *keep* gold-heavy, and the
right place to spend gold that gets reclaimed from elsewhere.

---

## 4. Cluster result

Ten distinct signatures across 168 hours, collapsing to a workable block scheme.
Proposed names describe the audience condition, not a legacy daypart:

| Block | Hours/wk | Cells (PT) | Orientation |
|---|---|---|---|
| **Deep Night** | 36 | daily 21–23, 00; +Sat/Sun 01–04 | Deep gold |
| **Full Footprint** | 30 | Mon–Fri 08–13 | Balanced, TSL-weighted — peak |
| **Wind Down** | 28 | Mon–Fri 17–20; Sat/Sun 16–20 | Gold-lean |
| **Home Drive** | 19 | Mon–Fri 14–16, plus 05 | Current-forward |
| **Continental** | 16 | Mon–Fri 02–03; Sat/Sun 05,07,15 | Balanced, Europe-only |
| **Weekend Wide** | 14 | Sat/Sun 08–14 | Balanced, TSL-weighted |
| **Eastern Sunrise** | 11 | Mon–Fri 06–07; Fri 14 | Current-forward — peak |
| *(three small residuals)* | 14 | scattered 01, 04, Fri 17–18 | merge into neighbours |

Eight blocks after merging residuals, against M3's eleven — comparable operational
complexity, materially better aligned.

---

## 5. Recommendations

1. **Retire Gold Lunch**, or move it to 21:00–22:00 PT where the index is 26–27.
2. **Extend the morning block down to 05:00 PT** and program it current-forward.
3. **Shift currents weight from PM Drive (17:00–19:00) to 05:00–07:00.** Net-neutral on
   currents inventory; strictly better placed.
4. **Keep the drive-hour A1 rate (2/hr) across the new Full Footprint block** rather
   than dropping to 1/hr at 08:00 — that drop currently lands exactly on the peak.
5. **Spend reclaimed gold in Evening (19:00–23:00 PT)**, the only genuinely
   single-region block.

Net effect: currents share rises from 31% toward the low 40s by *relocating* hours, not
by deepening pools. Pool depth remains a separate problem (`sheets/2026-07-31-slice.md`).

---

## 6. Known limits

- Propensity curves are assumed, not measured. **Nothing in this repo captures listener
  sessions.** Until geo/session data is collected, §2's index is a model, and the
  Friday and Sunday evening curves in particular are guesses.
- The weekday/weekend split assumes Mon–Thu are identical. The matrix confirms they are
  *under these assumptions*; real data may not agree.
- Daylight-saving shifts change every mapping here twice a year, and Europe and the US
  do not switch on the same dates — there are two multi-week windows annually when the
  US/Europe offset differs by an hour. Not modelled.
