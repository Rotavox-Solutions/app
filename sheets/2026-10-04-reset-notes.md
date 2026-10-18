# Reset changeset — authoring notes

- **Changeset:** `changesets/2026-10-04-ladder-reset-v4.json`
- **Date:** 2026-09-30 · **Week of review:** 2026-10-04
- **Why this file exists:** `CHANGESET-CONTRACT.md` permits exactly eight top-level keys
  (`changeset_version`, `id`, `station_id`, `authored_at`, `intent`, `basis`, `moves`, `set_enabled`).
  A `notes` key is rejected by `validateShape`, so the reasoning lives here instead — per §7,
  human-readable documentation belongs in `sheets/`.

## Provenance trimmed from `basis`

`basis` is declared as `{ sheet_id, sheet_captured_at? }`. These extra fields passed validation but
are not in the declared shape, so they are recorded here rather than risking a stricter validator:

- **census_captured_at:** 2026-09-30
- **census_source:** live RadioDJ via read-only tunnel
- **supersedes:** changesets/2026-10-04-ladder-reset-v3.json (entry-rule fix applied)

## Notes

**1.** ENTRY RULE for this reset, applied to the 31 unique new imports: 7-Day chart presence = established airplay = enter at the evidence rung, bypassing N. Absent from 7-Day (Spincrease and/or Taking Off only) = still breaking = enter at N. This is a principled line rather than a judgement call, and it is what fills N: 13 of its 18 seats come from imports that are gaining but have not yet charted.

**2.** N lands at 18 of 18 - AT TARGET, with no additional sourcing. The entry-rule fix moved Beabadoobee and Sublime out of N to B; the two seats were refilled from the Config 6 on-deck queue (Slipknot, Blossoms), which is exactly the case that queue exists for. Slightly Stoopid 'Backseat Drivin' (1 ALT add) remains on-deck in Y - the weakest of the three by evidence.

**3.** DUPLICATE HANDLING. Five imports are higher-quality replacements of songs already in the library (ids 1687, 1670, 463, 634, 2); the old file is DISABLED in place rather than moved, so it can never be selected while the replacement airs, and disabling removes it from enabled depth. Four more are untagged/Clean pairs within the import itself; the Clean version is placed and the untagged one disabled. THE CLEAN-OVER-UNTAGGED CHOICE IS A PD DECISION - the station has no stated policy and the import mixes Clean, Dirty, Radio Edit and Original Mix. Inverting it is a one-line change.

**4.** ARTIST SEPARATION drove three placements. FFDP 'Eye Of The Storm' (AR #16) goes to C rather than B because 'Nails In The Coffin' (AR #12) takes the FFDP seat in B; Evanescence 'Afterlife' and Sublime 'Ensenada' are benched for the same reason. FORMAT-WORKFLOW 1a.6: duplicate artists in a thin pool produce fill failures, not merely tighter rotation.

**5.** FOUR RECALLS FROM ZN. Nickelback (AR #2), Buffalo Traffic Jam (ALT #3), Edgehill (ALT #12) and Sam Fender (ALT #17) were swept N->ZN outside the changeset process, not retired by rule. They are restored to their evidence rungs rather than treated as ZN residents. Nothing But Thieves 'Evolution' (632) is left in ZN this week - it is Taking Off-only and N is already being filled from stronger imports.

**6.** DROPS STILL DEFERRED. 11.3's fell_off and trajectory triggers need a prior archive week; 2026-09-28 remains the only one. Every bench here rests on present-tense evidence - absent from all panel sources, or superseded by an imported record - which needs no history.

**7.** DATA QUALITY: Dominic Fike 'Babydoll' (id 557) is 97 seconds in A2, against a ~2:40 record. It is left in place on evidence (ALT #8) but the file looks truncated and it sits in a power tier at ~23 plays/week. Recommend checking before the next log generation.

**8.** NOT ADDRESSED: Young The Giant 'Evergreen' (id 1673, ALT #16) sits in W and was not imported because it is already owned. It is a recall candidate, not a sourcing need, and is left for the 2026-10-04 pass.

**9.** FORMAT BALANCE RESTORED. Before the second import N would have landed near 6 Active Rock / 15 Alternative, badly skewed against the 2.1 Active Rock x Alternative hybrid. The five placements here are 3 AR / 2 ALT, bringing N to roughly 7 AR / 11 ALT. Still alternative-leaning, but no longer lopsided against half the format.

**10.** ENTRY RULE FIXED, PD-approved 2026-09-30. A record now bypasses N on 7-Day presence OR top-3 on either add board. This cascaded through four rungs rather than just N: 2 records N->B, 2 displaced B->C, 2 displaced C->W, 2 promoted from the on-deck queue into N. Every rung still lands on target. The fix was needed because the original rule keyed only on 7-Day presence, so Des Rocs at AR #25 bypassed N while Sublime - 20 combined adds, Spincrease #2, Taking Off! #1 - sat in it.
