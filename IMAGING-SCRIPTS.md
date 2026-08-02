# The BOLT — imaging package

Complete copy for a fresh, coordinated imaging batch. Written 2026-08-02 against the M4
format (`tools/m4-format.mjs`), the format of record in `FORMAT-WORKFLOW.md` §0a, and the
measured listener behaviour in `sheets/2026-08-02-listener-digest.md`.

**Priority order for going to air:** the mount intro alone is worth more than everything
else combined. Produce §1, ship, and let the rest fall back to existing generic liners.

---

## 0. Voice and rules

**The station:** The BOLT — Alternative CHR ("New Rock"). 45% currents. Active Rock ×
Alternative hybrid. Las Vegas origin, worldwide audience. `thebolt.stream`. Part of the
CLUBFM network.

**Voice:** Dry, fast, unimpressed. Never hyped, never "radio voice". The station sounds
like someone who knows the music and isn't selling it. Closer to a good bartender than a
morning DJ.

**Hard rules, all derived from measurement:**

1. **Nothing over 8 seconds except promos.** The median session that dies, dies at ~1
   second. Talk is the tax the listener pays before the music proves itself.
2. **Never say "you're listening to".** They know. Use the seconds on something else.
3. **No local-service framing.** No traffic, no weather, no "here in the valley". The
   audience is global — the daypart grid literally has blocks named European Morning and
   Continental. Vegas is a *flavour*, not a service area.
4. **Never promise a specific song or artist next.** The log is scheduled but the pacer
   can trim to fit. A broken promise is worse than no promise.
5. **Say the name.** Every element that can carry it, carries it. A listener who cannot
   name the station cannot come back to it, and directory listings are the acquisition
   channel.
6. **Write for someone who has heard nothing else.** 85% of sessions end inside five
   minutes. Almost nobody has context. Every element stands alone.

---

## 1. Mount intro — the single highest-value asset

**What it is:** Icecast's per-mount `<intro>` file, streamed to every client *before* it
joins the live feed. Configured in AzuraCast's mount point settings, not in the log
(ADR-0001 §3.5a). It is outside Rotavox entirely.

**Why it matters more than anything else here:** it is the **only element with 100%
new-listener reach**. Every other element in this document reaches only the fraction of
listeners who happen to be connected when it airs. Measured: **85% of sessions end within
five minutes** and the bail mode sits at ~1 second, so most listeners hear one or two
songs and quite possibly no imaging at all. The intro is the only thing they *cannot*
miss.

**Design constraint that follows:** it must be extremely short. Every second before music
is a second of a sampling listener's patience spent on talk. Anything over ~7 seconds is
actively working against the thing it's for.

### Recommended — "One song"

> **"This is The BOLT. New rock, out of Las Vegas, worldwide.**
> **Give us one song."**

*≈5 seconds. Music bed, no sting.*

This is deliberately a direct intervention on the measured failure mode. The data says
the listener is deciding inside sixty seconds; the copy asks for exactly the commitment
that's at risk, and asks small. "Give us one song" is a smaller ask than "stay tuned",
and it sets a checkpoint the listener will actually reach.

It also names the station, positions the format, and establishes the global-with-a-place
identity in eleven words.

### Alternates

**B — "Nothing you've worn out"**
> "The BOLT. New rock first — and nothing you've already worn out. Here we go."

*≈6s. Leans on the 45% current share, which is the actual product differentiator against
the Active Rock stations a directory will list next to us.*

**C — "Found it"**
> "You found The BOLT. New rock, all day, from Las Vegas to wherever this is reaching you."

*≈6s. Acknowledges directory discovery explicitly — most listeners arrive from a station
list, and naming that is disarming.*

**D — Shortest viable**
> "The BOLT. New rock."

*≈2s. Use if testing shows any talk at all suppresses retention. The floor case: names the
station and nothing else.*

### Test it — this is now measurable

AzuraCast supports one intro per mount, so variants rotate manually. Run each for a full
week, then:

```bash
python3 tools/analyze-listeners.py --report <logs> --tz -7 \
  --exclude-ip <your-ip> --since YYYY-MM-DD --until YYYY-MM-DD
```

Compare **bail rate under 5 minutes** across weeks. Two cautions from the digest:
survivor share carries SE ≈1.2%, so a difference under ~2.5 points is noise; and one week
is ~460 human sessions, so anything subtle needs longer. **Do not** compare survivor TSL
between variants — its 95% CI spans 25–51 minutes and it will move on its own.

---

## 2. TOH IDs — 46 scripts across 9 blocks

One per hour, per block, so the hour opens with what the station *is* at that moment.
Depth is sized to ~47h turnover — roughly 0.5 plays/day, below conscious recognition.

Block hours are station-local Pacific. **Never state a local clock time** — the audience
spans every timezone.

### ES · Eastern Sunrise — 4 scripts
*05:00–07:00 PT = 08:00–10:00 US East. The American East Coast is up and moving.*

1. "The BOLT. New rock, already going while the coast catches up."
2. "East coast is up. The BOLT — new rock from Las Vegas."
3. "Morning, somewhere. The BOLT."
4. "The BOLT — new rock, no warm-up."

### FF · Full Footprint — 8 scripts
*08:00–13:00 PT. The widest simultaneous audience of the week — US midday plus European
evening. This is the station's centre of gravity.*

1. "Vegas, New York, London, wherever. The BOLT — new rock."
2. "The BOLT. Same station, twenty-four timezones."
3. "New rock, all day. The BOLT."
4. "The BOLT — Las Vegas, and everywhere this reaches."
5. "Most of the world is awake for this one. The BOLT."
6. "The BOLT. New rock first, always."
7. "You're a long way from Vegas. Doesn't matter. The BOLT."
8. "The BOLT — new rock, worldwide."

### HD · Home Drive — 4 scripts
*14:00–16:00 PT = 17:00–19:00 US East. American drive time.*

1. "The BOLT. New rock for the way home."
2. "Whatever that day was — The BOLT."
3. "The BOLT — new rock, louder on the way home."
4. "Drive time somewhere. The BOLT."

### CO · Continental — 6 scripts
*02:00–04:00 PT = 11:00–13:00 CET. European midday.*

1. "The BOLT — new rock, straight through your afternoon."
2. "Vegas is asleep. The BOLT isn't."
3. "The BOLT. New rock, continental hours."
4. "Middle of your day, middle of our night. The BOLT."
5. "The BOLT — new rock from Las Vegas, on your clock."
6. "The BOLT. Still going."

### WW · Weekend Wide — 4 scripts
*Weekend 08:00–15:00 PT. The long weekend stretch.*

1. "No schedule today. The BOLT."
2. "The BOLT — new rock, and a longer leash on the weekend."
3. "Weekend. The BOLT, new rock."
4. "The BOLT. Nothing to be on time for."

### WD · Wind Down — 8 scripts
*17:00–20:00 PT. Evening.*

1. "The BOLT. New rock, into the evening."
2. "The BOLT — the day's done arguing."
3. "Evening. The BOLT, new rock."
4. "The BOLT. Still new, slightly darker."
5. "The BOLT — new rock, after hours-ish."
6. "Wherever the evening finds you. The BOLT."
7. "The BOLT. New rock, no last call."
8. "The BOLT — Las Vegas, worldwide, all night from here."

### GH · Golden Hour — 2 scripts
*21:00 PT. The gold-exclusive hour — the one place H1 and H2 run together.*

1. "Golden Hour on The BOLT. Everything that got us here."
2. "The BOLT — Golden Hour. Older, louder, earned."

### EM · European Morning — 7 scripts
*23:00–01:00 PT = 08:00–10:00 CET. Europe is starting its day.*

1. "Good morning, Europe. The BOLT — new rock from Las Vegas."
2. "The BOLT. We never stopped."
3. "Morning over there. The BOLT, new rock."
4. "The BOLT — new rock, awake before you are."
5. "Vegas nights, European mornings. The BOLT."
6. "The BOLT. New rock to start on."
7. "The BOLT — new rock, no matter what time you think it is."

### DN · Deep Night — 3 scripts
*22:00 PT. Lowest cume, longest sessions — the copy earns the right to be quieter.*

1. "The BOLT. New rock, low lights."
2. "Still here. The BOLT."
3. "The BOLT — new rock, deep night."

---

## 3. Liners — need 149, have 41

The most generic element and the highest-volume one. Repetition of a 3-second liner is
far less noticeable than repetition of a promo, so a shorter turnover here is acceptable
if 149 is unrealistic — but the count is what holds a 47-hour rotation.

**Rule: a liner never has a fallback.** A wrong-context liner is worse than none
(`FALLBACK` in `tools/clock-order.mjs`).

### Name-forward (write ~40)
1. "The BOLT."
2. "New rock. The BOLT."
3. "The BOLT — new rock."
4. "This is The BOLT."
5. "The BOLT. thebolt.stream."
6. "New rock, all day. The BOLT."
7. "The BOLT — Las Vegas."
8. "The BOLT, worldwide."

### Format-forward (write ~40)
9. "New music first."
10. "Nothing you've worn out."
11. "New rock, no filler."
12. "The new stuff, louder."
13. "If it's new and it's loud, it's here."
14. "Rock that isn't finished yet."
15. "The BOLT — where new rock goes first."
16. "Half of what we play didn't exist last year."

### Attitude (write ~40)
17. "No requests. No apologies."
18. "We don't do throwbacks. Much."
19. "Turn it up or don't."
20. "The BOLT. Loud is the point."
21. "Not for everybody. Probably for you."
22. "The BOLT — opinions included."

### Global identity (write ~30)
23. "Las Vegas. Everywhere else too."
24. "The BOLT — twenty-four timezones, one station."
25. "Wherever this is reaching you."
26. "The BOLT. Not a local station."
27. "Vegas made, globally distributed."

---

## 4. New-Music Sweepers — 24 needed, 44 held ✓

Placed **ahead of** an N or A1 track. The listener is about to hear something new; this
frames it so it reads as intent rather than an unfamiliar song they don't like yet.

1. "New. Right now."
2. "This one's brand new."
3. "First on The BOLT."
4. "You haven't heard this yet."
5. "New rock, emphasis on new."
6. "Fresh. The BOLT."
7. "Brand new — The BOLT."
8. "Straight from the new pile."
9. "This just landed."
10. "New music, no ceremony."

*Inventory is sufficient. Refresh for cohesion only.*

---

## 5. Gold Backsells — 32 needed, 26 held

Placed **behind** a gold track (G2010 / G2000 / G1990). The listener just heard something
they know; this names it as a deliberate choice rather than filler.

**Never name the artist** — these are generic-position elements and the log can trim.

1. "That one still works."
2. "Some of them earn it."
3. "The BOLT — we keep the good ones."
4. "Still holds up."
5. "That's why it's still here."
6. "Gold, and not by accident."
7. "The BOLT. We remember."
8. "That one's been around. So have we."

*Write ~6 more for depth.*

---

## 6. Heritage Backsells — 8 needed, **0 held**

**New pool.** Placed behind an H1 or H2 track — the pre-1990 material. Subcategory 35;
positions wired 2026-08-02 in Golden Hour (×2) and Weekend Wide (×1).

This is where value proposition #2 becomes audible. Pre-1990 inclusion is a
differentiator no chart rewards, and backselling a 1978 record with copy written for 2010s
gold throws it away. Falls back to Gold Backsells where unavailable — still
context-correct, just less pointed.

**Never state a year.** The library's year data is known-unreliable (`FORMAT-WORKFLOW`
§0), and a wrong year is a credibility loss for exactly the listener who'd notice.

1. "Older than most of what we play. Doesn't matter."
2. "That's where this all came from."
3. "The BOLT — we go back further than you'd think."
4. "Before your band's parents met."
5. "Still louder than most of what came after."
6. "That one built the rest of it."
7. "The BOLT. Some of it's vintage. All of it's loud."
8. "They were doing this first."

---

## 7. Relaunch Sweepers — 8 needed, 12 held ✓

Placed **ahead of** an A1 or A2 track — the power tier. These carry the most weight per
airing since A1 records play ~32×/week.

1. "This is the one."
2. "Big one coming."
3. "The BOLT — power hour, all hours."
4. "You know this one already."
5. "Loudest thing we've got."
6. "The BOLT. Turn it up."

*Inventory sufficient.*

---

## 8. Station Promos — 45 needed, 14 held

The only elements allowed to run long (15–30s). They carry the things a 5-second liner
can't.

### The format promise
> "Here's the deal. Most rock stations play you the same forty songs they played in 2011.
> The BOLT plays new rock — nearly half of everything here came out in the last year.
> The rest earned its place. **thebolt.stream.**"

### Global identity
> "The BOLT comes out of Las Vegas, but almost nobody listening is in Las Vegas. We're in
> your morning, your commute, your three a.m. Same station, every timezone.
> **The BOLT — thebolt.stream.**"

### Golden Hour appointment
> "Every night, one hour, no new music at all. Golden Hour on The BOLT — everything that
> got rock to where it is now, back to back. Nothing from this year. Nothing you have to
> learn. **The BOLT.**"

### Discovery
> "Some of what we play, nobody's heard yet. Not a chart, not a playlist someone else
> made — just new rock we think is worth your time. Sometimes we're wrong. Usually we're
> early. **The BOLT.**"

### The anti-chart position
> "We don't just play what American radio plays. Half our audience isn't in America.
> The BOLT plays new rock from wherever it's actually good. **thebolt.stream.**"

### Directory / findability
> "If you found us in a station list, do the thing that makes it easy to come back —
> favourite it, bookmark it, whatever your app calls it. **The BOLT. thebolt.stream.**"

*Write ~39 more. The six above cover the distinct positions; the rest are variations of
these, not new arguments.*

---

## 9. Production notes

- **Consistent bed across the package.** Cohesion comes from the bed and the voice, not
  the words. One bed family, one voice, all elements.
- **Match loudness to the music.** A liner that jumps 3 dB above the songs reads as an
  advert and gets tuned out.
- **Cold ends.** No music tails hanging into the next element — the pacer's timing is
  computed from `cue_times`, and those change between syncs.
- **Set `cue_times` on every produced element**, because effective length is what the
  scheduler paces against, not file length. Getting this wrong on imaging is how the
  earlier ~24s/hour timing error happened.
- **Produce the mount intro first and separately.** It does not live in RadioDJ at all —
  it uploads to the AzuraCast mount point.

## 10. What to do this week

1. **Produce the mount intro (§1).** One file. Go to air on it.
2. Ship with existing imaging; generic liner fallback is acceptable and already wired.
3. **Fix the TuneIn mount** — still 404ing ~280×/day, which costs more listeners than any
   imaging decision in this document.
4. Then TOH IDs (§2), because per-block identity is what M4 bought and generic TOH throws
   it away.
5. Heritage Backsells (§6) last — 8 scripts, and the positions already exist.
