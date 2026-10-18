# BOLT metadata cleanup — fix list (NOT APPLIED)

- **Captured:** 2026-10-17 from live RadioDJ (`clubfm-broadcast-1`, `radiodj3`), enabled Music songs only (1,511).
- **Rows:** `2026-10-17-bolt-metadata-cleanup.tsv` — 851 songs, one row each, live value beside proposed value.
- **Status:** cut 2026-10-18 from a live snapshot taken at 20:01Z, by `tools/tag-cleanup.py`. **Not applied.**
  There are three changesets with no song in more than one, so each can be applied or skipped on its own. Together they
  hold exactly the 851 rows below, with identical values:
  - `changesets/2026-10-18-tags-artists.json`: 53 songs whose artist changes, with their title fixes too.
  - `changesets/2026-10-18-tags-versions.json`: 342 title fixes that strip a version tag, plus any key/BPM suffix.
  - `changesets/2026-10-18-tags-bpm.json`: 456 title fixes that are only a key/BPM suffix.

  Skipping `versions` also leaves the key/BPM suffixes on those 342 titles. Re-cut with the version rule
  off if the PD wants suffixes stripped but version tags kept.
- **Knock-on:** retagging trips the artist/title precondition in every earlier changeset and inverse. Replaying or
  rolling one back afterwards needs `--allow-tag-drift`.

## Classes (a row can have several)

| Class | Rows | What | Why it matters |
|---|---|---|---|
| `bpm/key-suffix` | 611 | Promo Only DJ suffix on the title: `Hooked 6A 128`, `Oblivion 153`. Promo Only paths only. Numbers without a key must be 60–200. | It shows on air and in now-playing. It also stops titles matching chart names. |
| `version-tag` | 350 | `(Clean)`, `(PO Clean Edit)`, `(Radio Edit)`, `(Original Mix)`, `(Album Version)`, `(… Remaster…)`, `[Clean]`, `(Dirty)`, bare trailing `Clean`/`Edit`. | On-air text. Real alternate versions are **kept**: Acoustic, Live, Remix, `[2025 Version]`, `(Active Rock Mix)`, `(Triple J Like A Version)`. |
| `artist-fix` | 42 | `AC; DC`→`AC/DC`, `X F.; Y`→`X feat. Y`, comma-split band names (`Mumford, Sons`, `Of Mice, Men`, `Coheed, Cambria`), spelling variants unified, typos (`Caroline  Lachek`, `Marilyn Mansion`, `Koяn`, `E, Tommy Walter`→`Eels`). | The engine compares `artist.trim().toLowerCase()` (`packages/engine/src/separation.ts:6`). Today `Goo Goo Dolls` and `The Goo Goo Dolls` are treated as **different artists** for separation. |
| `member-list` | 11 | Gold VA-compilation tags that list band members after the band (`U2, Bono, The Edge, …`) are reduced to the band name. | Same separation problem. These are long junk strings on air. |

Variant canon picked (PD may flip): The Pretenders · Tom Petty And The Heartbreakers · Goo Goo Dolls · P.O.D. ·
AWOLNATION · Letdown. · SMITH · MOD SUN · The Smashing Pumpkins.

## Flagged, not in the fix list

- **Exposed duplicate:** Dexter and the Moonrocks "Freakin' Out": 1138 (W, PO `9A 124`) and 1231 (R1, Clean). Under
  the PD file preference this is a dedup call, not a tag fix.
- **Collab artist strings** (`Papa Roach, Toby Morse`, ~70 rows) are left as they are. Even cleaned, they don't separate
  from the primary artist. That needs the engine to compare primary artists (an engine change), not a retag.
- `Whitesnake - Here I Go Again 87` keeps its `87`: it is the '87 version, not a BPM.
- Not touched: `year` (2021 compilation years, untrusted per ADR §3.4), 654 empty albums, ALL-CAPS stylings that are real
  (R.E.M., NEEDTOBREATHE, Shinedown `MONSTERS`/`DEVIL`), and Title Case on PO tags (`7Th Floor`, `Mgk`). Fixing
  these needs a lookup source, not rules.
