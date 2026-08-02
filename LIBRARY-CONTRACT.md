# Library ↔ Clockset Contract — 2026-08-01

Captured live from RadioDJ. This is the coupling ADR-0001 §6 requires be recorded:
the M4 seed binds scheduler categories to these subcategory IDs, and a renumbering
or rename here silently yields an empty scheduler category.

## Mapped by the M4 seed

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

## Deliberately unmapped

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

## Note

The nine TOH pools (40–48) are **empty pending script production**. Their positions
fall back to Liners until filled, per the M4 fallback policy — so the seed is safe to
apply before the scripts exist, but the top of the hour will be a liner, not an ID.
