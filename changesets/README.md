# Changesets

Music-direction changes as reviewable, reversible artifacts. Format and rules:
`../CHANGESET-CONTRACT.md` v1.

```
changesets/
  <id>.json           authored changeset — commit before applying
  inverse/<id>.json   rollback artifact, written by the applier before it commits
  applied/<id>.json   run record: when, against which database, how many operations
```

## Applying

```sh
cd apps/runner
npm run apply-changeset -- ../../changesets/<id>.json                  # validate only
npm run apply-changeset -- ../../changesets/<id>.json --apply          # write
npm run sync-library                                                   # required after
```

Validate-only is the default; `--apply` is the explicit operator confirmation required
by contract §5. `--allow-tag-drift` downgrades artist/title mismatches to warnings, and
should only be used when a tag was legitimately corrected between sheet and changeset.

A precondition failure aborts the whole changeset. That is deliberate: live drifting
from the sheet means every decision in the file was made against stale evidence, not
just the row that tripped. Re-cut the sheet rather than editing the changeset to match.

**Re-sync the mirror after applying.** A log generated between apply and sync uses
stale pool membership.

## Rolling back

The inverse is a valid changeset. Apply it the same way:

```sh
npm run apply-changeset -- ../../changesets/inverse/<id>.json --apply
```
