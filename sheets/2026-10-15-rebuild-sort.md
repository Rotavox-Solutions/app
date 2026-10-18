# Rebuild sort — authoring notes and gap list

- **Changesets** (all applied 2026-10-15; inverses in `inverse/`):
  1. `changesets/2026-10-18-rebuild-sort.json`: pass 1, 698 moves, 17 disables.
  2. `changesets/2026-10-18-rebuild-imports.json`: pass 2 after the PD's second import, 384 moves,
     228 disables.
  3. `changesets/2026-10-18-rebuild-straggler.json`: The Trews "Manifest" (tab in title) to W.
  4. `changesets/2026-10-18-n-alternatives.json` (2026-10-16): 9 W records to N; see below.
- **Week of review:** 2026-10-18 · **Panel:** `charts/2026-10-15/`
- **Why:** the broadcast box was destroyed. On a fresh RadioDJ (`clubfm-broadcast-1`, 10.0.0.128) the
  PD loaded the whole library and placed the four gold/heritage compilations. Everything else came in
  unsorted: 687 Promo Only Modern Rock Radio tracks in R1, 48 ZIPDJ imports in N, and 18 record-pool
  files in W. Song IDs are new, so no earlier changeset can be replayed.

## Fresh install: subcategory IDs (Music, parent 1)

`1 G1990 · 2 H · 3 A2 · 4 G2000 · 5 A1 · 6 B · 23 C · 24 N · 25 F · 26 R1 · 27 R2 · 28 R3 · 29 G2010 ·
30 X · 31 Y · 32 Z · 33 ZN · 34 K · 35 W · 36 H2`

Imaging (created for pass 2): `37 Liners · 38 New-Music Sweepers · 39 New-Music Trail · 40 Relaunch
Sweepers · 41 Gold Backsells` (parent 3 Sweepers) · `42 TOH IDs` (parent 4) · `43 Station Promos`
(parent 6).

These differ from the 2026-08-01 install (`LIBRARY-CONTRACT.md`). **`tools/m4-seed.mjs` `SUBCAT`
must be updated before seeding.**

`K` is **Killed** (PD, 2026-10-16): records removed from the format for good. `tools/m4-seed.mjs` `SUBCAT` now uses
these IDs.

## Method

1. **Gold untouched.** G1990/G2000/G2010/H are the PD's placement of four 100-track era
   compilations (*90s/2000s/2010s/80s Rock Essentials*). Their `year` tag is the compilation's
   release year (2021) for every track, so it is meaningless.
2. **Dedup.** One file per normalised artist+title. Preference order: Clean / Radio Edit / PO Clean
   Edit, then other tagged files, with Dirty and untagged WAV twins last. This is the 2026-10-04
   clean-over-untagged precedent, still a PD decision. 17 duplicates were disabled in place.
3. **Currents.** Placed from this week's panel against Config 11.2: A1 top-8, A2 top-15,
   B top-25-or-Spincrease, and entry rule v2 (format 7-Day, or top-3 on an add board, bypasses N).
   - Seats are filled top-down by evidence score (×1.25 cross-format, Triple A ×0.5, small bonuses
     for Spincrease, Taking Off and adds), and overflow cascades down a rung.
   - One ladder seat per artist. A charting second record goes to C (FFDP precedent); a second N
     record is benched.
   - The 2026-10-04 reset is the prior position:
     - Spincrease keeps an existing ladder record in B.
     - Former B/C records that are off every chart are **held in C**: this is their first week
       off, and fell_off needs 2.
     - A1/A2 exits go to R1.
     - N records with no signal go to ZN.
4. **Non-currents.**
   - A record with a pool in a committed changeset keeps it: R1/R2/R3/X/F/W/ZN.
   - A record with no recorded pool that aired at least 5 times in the M4 era (AzuraCast
     `song_history`, Aug 4–Sep 29, from the 2026-10-13 backup) is placed by Promo Only issue date:
     R1 from 2025-09, R2 from 2024-09, otherwise R3. R2 and R3 are capped at target +1, with the
     lowest-airplay records cascading down.
   - Everything else goes to W (bench), which matches its old state: no recorded pool and not in
     rotation.

## Caveats

- **The 7-Day charts are the Published week (Oct 4–10), not Rolling.** The Rolling selector would
  not take without a signed-in AllAccess session. See `charts/2026-10-15/_manifest.json`.
- About 300 of the old library's pool assignments came from the 2026-07-30 W-reclassify script, not
  a changeset, and were lost with the box. Airplay plus issue date stands in for them. For any
  single recurrent the R1/R2/R3 split is approximate; the depths are on target.
- Dirty files were placed where they are the only copy: The Paradox, Steve Lacy, Sublime.
- Disabled duplicates stay in their import subcategory (N/R1/W). They are disabled, so the engine
  ignores them.

## Resulting enabled depth vs M4 target

| Pool | Enabled | Target | Gap |
|---|---|---|---|
| A1 | 10 | 10 | — |
| A2 | 11 | 11 | — |
| B | 14 | 14 | — |
| C | 14 | 20 | **−6** |
| N | 9 | 18 | **−9** |
| R1 | 29 | 30 | −1 |
| R2 | 49 | 48 | +1 |
| R3 | 73 | 72 | +1 |
| X (Discovery) | 32 | 37 | **−5** |
| F | 66 | 75 | **−9** |
| G2010 | 100 | 148 | **−48** |
| G2000 | 100 | 104 | −4 |
| G1990 | 100 | 145 | **−45** |
| H (H1+H2) | 100 | 121 (24+97) | −21 |
| W | 424 | — | |
| ZN | 5 | — | |

## Gaps

### 1. Sourcing: chart records not in the library (90 total; the ones that matter)

Most of these were owned on the old box, in the record-pool folders (8th Wonder, FRP, Crate
Connect, Heavy Hits, Ultimix, Promo Only Express). Only 18 files from those folders made it onto the
new box, and no Promo Only issue after July 2026 is present.

| Artist | Title | Panel |
|---|---|---|
| Weezer | We Might As Well Be Strangers | ALT #3, Spincrease |
| Papa Roach | See U In Hell f/Hanumankind | AR #4 |
| Nickelback | Rattle The Cage f/John 5 | AR #5 |
| Motionless In White | RIP f/Skylar Grey | AR #7, Taking Off |
| Ninth Key | Happy Feels Like | AR #8, Spincrease #4 |
| Young The Giant | Evergreen | ALT #12 |
| Greta Van Fleet | Tear It Down | AR #20, Spincrease |
| Three Days Grace | Dominate | AR #22, Spincrease #1, 24 adds |
| Spiritbox | Mourning | AR #24, Spincrease |
| Leap | Exit Signs | ALT #24 |
| Staind | Ghosts | Spincrease #2, Taking Off #1 (AR) |
| The Strokes | Lonely In The Future | Spincrease #1, Taking Off #1 (ALT) |
| Interrupters | Warrior Spirit | 15 ALT adds (#2), Spincrease |
| Dayseeker | Shapeshift | 30 AR adds (#1) |
| Slash f/Myles Kennedy | Flying Blind | 20 AR adds, Spincrease #3 |
| Giovannie And The Hired Guns | Cheap Date | Spincrease #5, adds on both |

Four of the top 8 Active Rock records are missing, so A1 currently skews Alternative
(7 ALT-led / 3 AR-led). Sourcing the first five rows restores the hybrid balance (§0b.1).

### 2. Imaging: none in the library

No TOH IDs, liners, sweepers, backsells or promos were imported, and no imaging subcategories exist.
The M4 clocks' sweeper and TOH positions will go unfilled until imaging is imported and categorised:
*Liners, New-Music Sweepers, Relaunch Sweepers, Gold Backsells, Station Promos, TOH IDs*, plus the
nine per-block TOH pools.

### 3. Depth

See the table above. Gold is short on G2010 (−48) and G1990 (−45). H2 (pre-1980, 97) does not exist
as a pool.

## Pass 2 (after the PD's second import)

The PD manually reversed several pass-1 dedupe picks (Avatar, BSC, Beartooth, FFDP, The HU, Temper
City, Papa Roach, Volbeat, Sublime, Yungblud, TDG). Those stand as PD decisions; see also the
original-over-clean preference in memory. The PD then imported Recurrents (215), H2 (22), four more
gold compilations into Y, and the imaging library into subcats 37–43.

- **Ladder re-ranked** now that the missing chart records are on disk: Weezer to A1; Motionless In
  White, Papa Roach and Nickelback to A2; Young The Giant "Evergreen" to B.
- FATN: the WAV (424) went to A1 and the MP3 twin (455) was disabled.
- Gold from Y was placed by `year` tag (these compilations carry real years). uDiscover 90s: only the
  30 titles that aired in the AzuraCast history went to G1990; the other 35 went to W.

### Enabled depth after pass 2

| Pool | Enabled | Target | Gap |
|---|---|---|---|
| A1 | 10 | 10 | — |
| A2 | 11 | 11 | — |
| B | 14 | 14 | — |
| C | 19 | 20 | −1 |
| N | 18 | 18 | — (after pass 3) |
| R1 | 31 | 30 | +1 |
| R2 | 49 | 48 | +1 |
| R3 | 73 | 72 | +1 |
| X | 32 | 37 | **−5** |
| F | 66 | 75 | **−9** |
| G2010 | 158 | 148 | +10 |
| G2000 | 143 | 104 | +39 |
| G1990 | 205 | 145 | +60 |
| H | 105 | 24 | |
| H2 | 22 | 97 | **−75** |
| W | 558 | — | |
| ZN | 5 | — | |

Imaging enabled: Liners 41, New-Music Sweepers 44, New-Music Trail 16, Relaunch 12, Gold Backsells
26, TOH IDs 12, Station Promos 20. **Still missing:** the nine per-block TOH pools, GDEEP and
Heritage Backsells. The seed maps them to empty lists, and the engine falls back to TOH IDs / Gold
Backsells.

### Remaining sourcing (not on disk)

Staind "Ghosts", The Strokes "Lonely In The Future", Three Days Grace "Dominate", Interrupters
"Warrior Spirit", Dayseeker "Shapeshift", Slash f/Myles Kennedy "Flying Blind", Greta Van Fleet
"Tear It Down", Spiritbox "Mourning", Ninth Key "Happy Feels Like", Leap "Exit Signs". These are
what N (9/18) is short of.

## Pass 3: N alternatives (2026-10-16)

The PD can't source the panel records above, so N was filled from what is on disk. Rule: 2026
releases sitting in W with at most 1 BOLT play Jul 15–Oct 11, artist not in A1–C/N/R1/X, split
5 Active Rock / 4 Alternative. About 50 of the 2026 W records aired 100–500 times on the old box:
they are burned recurrents that overflowed the R caps, not new music, so they were excluded.

| ID | Artist | Title | Lean |
|---|---|---|---|
| 1094 | Black Veil Brides | Vindicate | AR |
| 1250 | Rob Zombie | (I'm A) Rock 'N' Roller | AR |
| 1164 | Saving Abel f/Scotty Austin | Hive Skidco | AR |
| 1185 | Crown Lands | Blackstar | AR |
| 1301 | Black Pistol Fire | High Horse | AR |
| 1073 | Bleachers | We Should Talk | ALT |
| 1205 | Jack White | GOD And The Broken Ribs | ALT |
| 1113 | Arctic Monkeys | Opening Night | ALT |
| 1208 | Royel Otis | Sweet Hallelujah | ALT |

Thirty Seconds To Mars "God's Eye" was considered and dropped: the file is 2:08, likely a short edit.
