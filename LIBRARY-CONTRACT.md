# Library ↔ Clockset Contract — 2026-10-15 (rebuilt box)

Captured live from the fresh RadioDJ on `clubfm-broadcast-1` after the 2026-10-15 rebuild. This is
the coupling ADR-0001 §6 requires be recorded: the M4 seed (`tools/m4-seed.mjs` `SUBCAT`) binds
scheduler categories to these subcategory IDs, and a renumbering or rename here silently yields an
empty scheduler category. **Every ID changed in the rebuild**; the 2026-08-01 table is kept below
for history only. Song IDs also changed, so no pre-rebuild changeset can be replayed.

## Mapped by the M4 seed

| Scheduler category | RadioDJ subcat | Enabled |
|---|---|---|
| A1 | 5 | 10 |
| A2 | 3 | 11 |
| B | 6 | 14 |
| C | 23 | 19 |
| N | 24 | 18 |
| R1 | 26 | 31 |
| R2 | 27 | 49 |
| R3 | 28 | 73 |
| G2010 | 29 | 158 |
| G2000 | 4 | 143 |
| G1990 | 1 | 205 |
| H1 | 2 (H) | 105 |
| H2 | 36 | 22 |
| Discovery | 30 (X) | 32 |
| F | 25 | 66 |
| TOH IDs (fallback for every per-block TOH pool) | 42 | 12 |
| Liners | 37 | 41 |
| New-Music Sweepers | 38 | 44 |
| Relaunch Sweepers | 40 | 12 |
| Gold Backsells | 41 | 26 |
| Station Promos | 43 | 20 |

Mapped to an empty list (no RadioDJ subcategory yet, so the engine falls back): the nine per-block
TOH pools (to TOH IDs), GDEEP, Heritage Backsells (to Gold Backsells).

**Membership is a seed-time snapshot until the station is imported** (ADR-0002 §4).
Before the import, `song_categories` is derived from `songs.rdj_subcategory_id` only when the
seed runs, and `sync-library` updates the subcategory but not the membership. So after any
changeset, re-derive membership (`refresh-memberships.sql`) before generating.

After the membership import (Station › Library & Runner › Pools), Rotavox owns membership and
lifecycle state:
- The mapping in this table lives in `categories.rdj_subcategory_ids`.
- The rows under "Deliberately unmapped" that encode a state (Y, Z, ZN, K, W) live in
  `stations.rdj_lifecycle_subcats`. Both are written by the seed, or by
  `seed/m4-projection.sql` alone.
- Pool and state edits are made in the UI (Music › Inbox, Music › Changes). Once applied,
  the Runner writes them to RadioDJ within seconds. If a write fails, Music › Changes
  shows why and offers "Sync and retry". Until a change is written, AutoDJ's fallback
  rotations still see the old subcategories, and Today says so.
- The Runner syncs the library every 15 minutes. Station › Library & Runner has Sync now
  and the output of every run. New songs land in the Inbox, with the pool their RadioDJ
  subcategory implies offered as "Accept RadioDJ's filing".
- `apply-changeset` mirrors every move into Rotavox after the RadioDJ commit.
  `refresh-memberships.sql` refuses to run. The M4 seed upserts categories in place and
  leaves membership alone.
- Re-running the full seed still clears `clock_position_id` on approved logs, which breaks
  TOH timing for a log that is on air.

## Deliberately unmapped

| Subcat | Name | Why |
|---|---|---|
| 39 | New-Music Trail | Imaging, 16 enabled; no clock position calls it yet |
| 31 | Y | Import staging for gold compilations |
| 32 | Z | Rested |
| 33 | ZN | Rested from N |
| 34 | K | Killed: records the PD has removed from the format for good |
| 35 | W | Bench |

### Imaging pools added 2026-10-27

Created for the 10K imaging renders (`bolt-imaging-handoff`) and filled by changeset
`2026-10-28-imaging-sort-render-10k`, which also added 20 renders to TOH IDs (42, now 32 enabled)
and 8 to Station Promos (43, now 28). None of these is mapped to a scheduler category or called by
a clock yet. Until one is, they air only through RadioDJ's own rotations, or as track sweepers
(65). Enabled counts are as of 2026-10-28.

| Subcat | Parent | Name | Enabled | Why |
|---|---|---|---|---|
| 51 | Station IDs | Stingers | 24 | Clock placement pending |
| 52 | Sweepers | Positioning | 20 | Clock placement pending |
| 53 | Sweepers | Front-sell | 16 | Clock placement pending |
| 54 | Sweepers | Back-sell | 16 | Clock placement pending |
| 55 | Sweepers | New Music Front | 8 | Clock placement pending |
| 56 | Sweepers | New Music Back | 8 | Clock placement pending |
| 57 | Sweepers | Transition Up | 10 | Clock placement pending |
| 58 | Sweepers | Transition Down | 10 | Clock placement pending |
| 59 | Sweepers | Power | 8 | Clock placement pending |
| 60 | Sweepers | Discovery Sweepers | 12 | Clock placement pending |
| 61 | Sweepers | Recurrent Sweepers | 8 | Clock placement pending |
| 62 | Sweepers | Gold 90s | 6 | Clock placement pending |
| 63 | Sweepers | Gold 00s | 6 | Clock placement pending |
| 64 | Sweepers | Gold 10s | 6 | Clock placement pending |
| 65 | Sweepers | Seasonal Halloween | 8 | Track sweepers on 8 songs until 2026-11-01; then disabled and kept for next October |
| 66 | Sweepers | Retired Imaging | 0 | Demoted imaging goes here instead of being deleted |
| 67 | Sweepers | Imaging Inbox | 0 | Landing spot for new imaging imports before they are sorted |

---

## Historical: 2026-08-01 install (destroyed box)

Captured live from RadioDJ. This is the coupling ADR-0001 §6 requires be recorded:
the M4 seed binds scheduler categories to these subcategory IDs, and a renumbering
or rename here silently yields an empty scheduler category.

### Mapped by the M4 seed

| Scheduler category | RadioDJ subcat | Name | Songs | Enabled |
|---|---|---|---|---|
| A1 | 4 | A1 | 7 | 7 |
| A2 | 2 | A2 | 10 | 10 |
| B | 1 | B1 | 6 | 6 |
| B | 5 | B2 | 13 | 13 |
| C | 3 | C | 23 | 22 |
| N | 23 | N | 8 | 8 |
| R1 | 24 | R1 | 22 | 22 |
| R2 | 25 | R2 | 34 | 34 |
| R3 | 26 | R3 | 42 | 42 |
| G2010 | 29 | G2010 | 166 | 165 |
| G2000 | 28 | G2000 | 152 | 150 |
| G1990 | 27 | G1990 | 187 | 186 |
| H | 30 | H | 101 | 94 |
| Discovery | 6 | X | 12 | 12 |
| Liners | 9 | Liners | 41 | 41 |
| New-Music Sweepers | 33 | New-Music Sweepers | 44 | 44 |
| Relaunch Sweepers | 8 | Relaunch Sweepers | 46 | 12 |
| Gold Backsells | 34 | Gold Backsells | 26 | 26 |
| Station Promos | 12 | Station Promos | 14 | 14 |
| TOH ES | 40 | TOH ES | 0 |  |
| TOH FF | 41 | TOH FF | 0 |  |
| TOH HD | 42 | TOH HD | 0 |  |
| TOH CO | 43 | TOH CO | 0 |  |
| TOH WW | 44 | TOH WW | 0 |  |
| TOH WD | 45 | TOH WD | 0 |  |
| TOH GH | 46 | TOH GH | 0 |  |
| TOH EM | 47 | TOH EM | 0 |  |
| TOH DN | 48 | TOH DN | 0 |  |

### Deliberately unmapped

| Subcat | Name | Songs | Why |
|---|---|---|---|
| 10 | TOH IDs | 31 | Old copy, retired; folding TBD |
| 36 | W | 505 | Bench |
| 38 | Z | 5 | Rested, origin unrecorded |
| 39 | ZN | 148 | Rested from N — correctly out of rotation |
| 31 | F | 5 | Intent unrecorded |
| 37 | GDEEP | 2 | Too shallow to schedule |
| 32 | Sonic Logos | 0 | Empty |
| 35 | Heritage Backsells | 0 | Empty |

### Note

The nine TOH pools (40–48) are **empty pending script production**. Their positions
fall back to Liners until filled, per the M4 fallback policy — so the seed is safe to
apply before the scripts exist, but the top of the hour will be a liner, not an ID.

---

## Metadata census — 2026-08-02

Run before commissioning any sourcing work, to avoid paying to acquire what is already
present. Result: **almost nothing is already present.**

| Column | Coverage | Verdict |
|---|---|---|
| `loudness` | 1448/1448 | **Useless** — constant 1.00, a replay-gain default |
| `bs_loudness` | 1448/1448 | **Useless** — constant 1.00 |
| `bs1770` | 0 | Not computed |
| `cue_times` | 1448/1448, **1446 distinct** | **Real** — per-track start / crossfade / end / fade |
| `year` | 1448/1448 | Present, untrusted (ADR §3.4) |
| `mood` | ~5% | Effectively empty |
| `rating` | 0 | Unused |
| `bpm` | 660/1448 | Missing on 788 — see below |

**Coverage is not usefulness.** Three loudness columns report full population and hold
nothing but defaults; `min = max = avg = 1.00` across every pool. This is the same trap
as the year field, where 100% coverage masks unreliable values. Any future census should
check *distinct value counts*, not row counts.

Consequence: there is **no loudness data**, so energy must be computed entirely from
audio. Nothing in the analysis pass can be skipped.

### BPM coverage, by where it matters

| | Have | Missing |
|---|---|---|
| Gold (G1990 / G2000 / G2010 / H) | 4 | **602** |
| W bench | 353 | 152 |
| Currents, ZN, recurrents | ~303 | ~34 |
| **Total** | **660** | **788** |

Present where it is not needed, absent where it is.

**The 660 are a validation set.** Running the beat tracker against tracks that already
carry a stored BPM measures its accuracy directly, before trusting it on the 788
unknowns — better evidence than a heuristic guess at which estimates are shaky.
