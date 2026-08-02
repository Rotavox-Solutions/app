# Hour length — diagnosis, fix, and the recovery gap it exposed

**Date:** 2026-08-02 · **Status:** fix implemented, F sourcing pending PD approval

---

## 1. The problem

Hours ran 54.4–63.9 minutes against a 60-minute clock. Roughly half ran short, several by
5+ minutes.

**It was not variance. Every clock was short before a single song was drawn.**

| clock | music positions | avg minutes | p10 minutes |
|---|---|---|---|
| ES / FF / HD | 16 | **55.6–56.0** | 46.5–46.8 |
| CO / WW / EM | 16 | 56.8–57.6 | ~46.5 |
| WD | 16 | 58.4 | 46.4 |
| DNa / DNb | 15 | 56.6–56.9 | 43.9 |
| GHa / GHb | 15 | 60.2 | 44.9 |

**Cause:** the clocks were authored assuming ~3.5-minute songs. The library actually
averages **A1 194s · C 205s · A2 208s · B 218s** — 3.2 to 3.6 minutes. Over 16 positions
that compounds into a 2–4½ minute hole at the average draw, and 13–16 minutes on a
short-song hour.

Weekly deficit at the average draw: **489 minutes** ≈ 144 filler plays per week.

### A secondary contributor, now fixed

Migrations `0003` and `0004` had never been applied to production, so
`effective_duration_ms` did not exist and logs were built on **file duration**. RadioDJ
segues at `xta`, before the file ends — measured across 1,466 music tracks, file duration
overstates real airtime by **1.53 s/track ≈ 24 s/hour**, always in the short direction.

Migrations are applied. But note this is worth ~24 s against a 5-minute problem: it was a
rounding correction, not the fix.

---

## 2. Why F rather than padding a scheduled category

The obvious fix — pad the tail with gold or recurrents — is wrong for three reasons.

**1. It would invalidate the depth solve.** 144 plays/week into G2010 is a **45% increase**
on its 321 slots/week, cutting turnover from 87h to ~60h and destroying the drift and lock
properties that depth was chosen to produce. F sits outside the solve entirely: every
scheduled category's slots/week is unchanged.

**2. The mix would drift silently.** Currents 45% / gold 29% is a format-of-record
commitment (`FORMAT-WORKFLOW` §0a). Filler drawn from gold raises gold share on exactly
the hours that run short — the station returns to its old sound without anyone choosing it.

**3. Filler must stay visible.** A stretched hour showing `F` is legible. The same hour
showing `G1990` is indistinguishable from programmed gold. That is the identical
invisibility that hid M3's gold-heavy sound for an entire era, and the same class of bug
as the TOH-fallback issue found earlier today.

### F must be deepened first

At its current depth of 5, absorbing 144 plays/week means **4.1 plays/song/day — hotter
than A1 at 4.54.** Five tracks would become the most-played records on the station.

| F depth | turnover | plays/song/day |
|---|---|---|
| **5 (today)** | 5.8h | **4.1** ✗ |
| **75 (proposed)** | ~88h | 0.27 ✓ |
| 153 (all candidates) | ~178h | 0.13 |

**75 is the recommendation** — the smallest depth with sane turnover, which minimises how
many benched songs get promoted back to air.

`changesets/2026-08-02-f-filler-depth.json` moves 70 tracks W → F. All are rock/alt genre,
one per artist, no artist already in currents, 150–280s so they actually close a gap.
Average 198s. **70/70 preconditions verified against live.**

**PD review needed:** W is the bench — some of it is deliberate rejection, some unsorted
overflow. These 70 will air.

---

## 3. The fix

Tail filler positions calling F, appended after each clock's programmed content.

```js
export const TAIL_FILLER = {
  ES: 5, FF: 5, HD: 5, CO: 5, WW: 5, WD: 5, EM: 5,
  DNa: 6, DNb: 6, GHa: 6, GHb: 6,   // 15-music clocks need one more
};
```

**No engine change was needed.** The generator already had the mechanism and its own
comment said so: *"Trim-to-fit: once a position's projected start reaches the clock's
length, drop it and everything after it. Filler authored at the tail falls off first."*
Over-authoring is free. We had authored to exactly 60 and given trim nothing to remove.

**Result: 11/11 clocks now reach 60 minutes even at a p10 song draw.** At an average draw
they total 72–77 minutes, so 1–2 F positions survive and the rest trim.

**Second benefit, not incidental:** tail filler now absorbs trimming on *long* hours. Before
this, a long hour trimmed **programmed** positions — the tail of the clock was real content.
Now F falls off first and the programmed hour survives intact.

---

## 4. The recovery gap this exposed

There is currently **no way to intervene in an airing log.** The only options are let it
run, or drop to AutoDJ. Two capabilities are missing:

### 4a. Pause / resume an airing log

The pacer stops pushing; AutoDJ resumes; on unpause the pacer picks the beat back up.

Half the mechanism exists — the watchdog already forces `EnableAutoDJ=1` after 20 s of
stale pacer heartbeat, so the *handoff to* AutoDJ is solved. What is missing is a
deliberate, reversible trigger and a defined resume point (next unpushed item vs.
re-cursor to wall-clock).

### 4b. Immediate-start log, generated to the next TOH

Today's generation produces a future-start log over a long horizon. A PD in trouble needs
a **short bridge log that starts now and ends at the next top of hour**, so control can be
regained mid-hour without waiting for a window to open.

This is the more valuable of the two: it is a genuine emergency-recovery primitive.
Takeover currently happens when `now` enters the log's `startsAt`…`endsAt` window
(`pace.ts` `startupForLog`), so an immediate-start log needs no pacer change — only a
generation mode that anchors `startsAt` to now and `endsAt` to the next hour boundary.

**Both belong in the spec.** Neither is a workaround; they are the missing half of "the PD
approves the log" — approval implies the ability to *un*-approve.

---

## 5. Still open

- **F sourcing needs PD sign-off** (70 tracks off the bench).
- **The Runner on `Teset` is a partial deployment** — `apps/runner` only, no `packages/`,
  and its bundled `@rotavox/schema` predates `effectiveDurationMs`. Until it is redeployed,
  the cue-derived duration column stays null and the 24 s/hour drift remains.
- **The proper long-term fix is duration-targeted clocks** rather than count-targeted:
  author SHAPES against 60 minutes and re-run the depth solver. That moves every depth
  target and means resizing the library. Tail filler makes it non-urgent, not unnecessary.
