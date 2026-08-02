# Listener session digest

- Window: **2026-07-15 → 2026-08-02** (18 days)
- Log lines: **824,992** (789,693 infrastructure, excluded)
- **Sessions: 28,329** (1586/day)
- Failed audio requests: **6,970** — see *Rejected connections*
- Local hours reported at UTC-7

## Automation separation

| | sessions | share | distinct IPs |
|---|---|---|---|
| Automated | 27,358 | 96.6% | 246 |
| **Human (residual)** | 971 | 3.4% | 366 |

> **The human set is a residual, not a clean population.** Everything not
> positively identified as automated lands in it, so its bail rate is an *upper*
> bound and its survivor share a *lower* bound. The true audience is at least
> this good and probably better.

| user agent | sessions | IPs | req/IP | verdict |
|---|---|---|---|---|
| `Mozilla/5.0 (Windows NT 10.0; Win64; x64) A…` | 14,714 | 2 | 7357 | auto — concentration |
| `Mozilla/5.0` | 11,438 | 9 | 1271 | auto — named |
| `python-requests/2.27.1` | 264 | 31 | 9 | auto — named |
| `TARV-RadioDiscovery/2.0.0 (+metadata-only n…` | 146 | 1 | 146 | auto — named |
| `Mozilla/5.0 (compatible; FlowIQLabsBot/1.0;…` | 122 | 23 | 5 | auto — named |
| `mrtscan/1.0 (westus)` | 119 | 16 | 7 | auto — named |
| `Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 lik…` | 106 | 2 | 53 | human |
| `ORB HisBot/26b72 (http://onlineradiobox.com…` | 97 | 2 | 48 | auto — named |
| `Mozilla/5.0 (Linux; Android 10; K) AppleWeb…` | 64 | 11 | 6 | human |
| `Mozilla/5.0 (compatible; CensysInspect/1.1;…` | 63 | 30 | 2 | auto — named |
| `-` | 59 | 49 | 1 | auto — named |
| `visionheight.com/scan Mozilla/5.0 (Macintos…` | 57 | 5 | 11 | auto — named |
| `Mozilla/5.0 (iPhone; CPU iPhone OS 27_0_0 l…` | 54 | 7 | 8 | human |
| `Hello from Palo Alto Networks, find out mor…` | 53 | 49 | 1 | auto — named |
| `Python/3.14 aiohttp/3.14.3` | 46 | 1 | 46 | auto — named |

### Listening-hour concentration

Which addresses own the listening time. A relay or an insider at the top of this
table invalidates every aggregate above it, and neither is caught by
volume-based detection — a relay makes very few, very long connections.

Human listening: **131h** across **366** addresses.

| address | sessions | hours | share |
|---|---|---|---|
| `2607:fb91::/32` | 26 | 20.1 | 15.4% |
| `2607:fb90::/32` | 94 | 17.7 | 13.5% |
| `2607:fb90::/32` | 22 | 17.3 | 13.2% |
| `136.36.x.x/16` | 48 | 16.2 | 12.4% |
| `2607:fb90::/32` | 12 | 9.0 | 6.9% |
| `2607:fb91::/32` | 4 | 8.1 | 6.2% |
| `2607:fb91::/32` | 6 | 7.3 | 5.6% |
| `2607:fb91::/32` | 13 | 6.6 | 5.1% |

Excluded via `--exclude-ip`: `65.181.`

**Everything below is the human residual only.**

## Bail vs stay

**No reliable mode boundary.** The deepest trough (at 28s) has a
dip of only 14%, below the 35% floor required to call a
split real. On a corpus this size shallow local minima are noise.

**5 minutes is used below as a stated convention, not a derived threshold.**
It is long enough to exclude sampling and short enough that anyone past it is
listening on purpose. Re-run once the corpus grows; the boundary may resolve.

| | count | share |
|---|---|---|
| **Bailed** (< 5.0m) | 824 | **84.9%** |
| **Stayed** (≥ 5.0m) | 147 | **15.1%** |

### Robust dispersion, per mode

Reported as median / IQR / MAD rather than mean and standard deviation. A
bimodal, heavy-tailed population has **no single valid location-and-spread
pair** — any figure spanning both modes describes a duration nobody experiences.
So each mode is summarised separately, and the mean is shown only to be
dismissed.

| mode | n | median | IQR | MAD | mean |
|---|---|---|---|---|---|
| Bailed | 824 | **1s** | 0s – 6s | 1s | 14s |
| **Stayed** | 147 | **37.5m** | 13.2m – 1.17h | 27.1m | 52.0m |

**Survivor TSL: median 37.5m, IQR 13.2m – 1.17h.** This is the TSL figure to use.
Its mean (52.0m) is 1.4× the median, which is the tail talking.

### Fixed reference cuts

| under | count | share |
|---|---|---|
| 5s | 602 | 62.0% |
| 10s | 652 | 67.1% |
| 30s | 726 | 74.8% |
| 1.0m | 771 | 79.4% |
| 5.0m | 824 | 84.9% |
| 30.0m | 889 | 91.6% |

### Distribution

```
     1s | ████████████████████████████████████████     125
     1s |                                                0
     2s | ████████████                                  40
     2s |                                                0
     3s | █████████                                     31
     4s | ████                                          13
     5s | ████                                          13
     6s | ████████                                      25
     8s | ███                                           12
    10s | █████                                         16
    13s | █████                                         17
    17s | ███████                                       23
    22s | ██                                             8
    28s | █████                                         16
    35s | █████                                         18
    45s | ████                                          15
    58s | ███                                           12
   1.2m | ██                                             9
   1.6m |                                                1
   2.0m | █                                              6
   2.6m | █                                              5
   3.3m | █████                                         17
   4.2m | ██                                             9
   5.4m | █                                              6
   6.8m | ███                                           10
   8.7m | ██                                             7
  11.2m | ███                                           11
  14.3m | █                                              6
  18.3m | ███                                           10
  23.4m | ████                                          14
  29.9m | █                                              5
  38.2m | ██                                             8
  48.8m | ██                                             9
  1.04h | ████████                                      25
  1.33h | ███                                           12
  1.70h | ███                                           11
  2.17h | ██                                             7
  2.78h |                                                3
  3.55h |                                                2
  4.54h |                                                1
```

## User agents

Scrapers are **detected, not assumed**. A short session is not evidence of a bot;
a *regular* one is. Low gap-variance (CV) means connections arrive on a timer,
which is what a directory health-check looks like and what a human never does.

| user agent | conns | share | median | bail % | gap CV | every |
|---|---|---|---|---|---|---|
| `Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS…` | 106 | 10.9% | 26s | 72% | 3.52 | — |
| `Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.…` | 64 | 6.6% | 6s | 95% | 2.66 | — |
| `Mozilla/5.0 (iPhone; CPU iPhone OS 27_0_0 like Mac …` | 54 | 5.6% | 50.0m | 19% | 1.70 | — |
| `Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS…` | 41 | 4.2% | 20.6m | 32% | 1.78 | — |
| `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebK…` | 36 | 3.7% | 0s | 100% | 1.00 | — |
| `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebK…` | 35 | 3.6% | 0s | 100% | 2.80 | — |
| `Mozilla/5.0 (compatible; Infrawatch/1.0; +https://i…` | 32 | 3.3% | 0s | 100% | 0.73 | — |
| `Mozilla/5.0 zgrab/0.x` | 30 | 3.1% | 0s | 100% | 0.77 | — |
| `Espiker/0.1 (contact@espiker.com)` | 22 | 2.3% | 0s | 100% | 0.63 | — |
| `Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:134.0) G…` | 20 | 2.1% | 3s | 100% | 1.46 | — |
| `Mozilla/5.0 (Macintosh; Intel Mac OS X 13_1) AppleW…` | 20 | 2.1% | 0s | 100% | 1.81 | — |
| `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) App…` | 20 | 2.1% | 50s | 95% | 0.60 | — |
| `radio-collector/1.0` | 19 | 2.0% | 1s | 100% | 0.75 | — |
| `VLC/3.0.23 LibVLC/3.0.23` | 18 | 1.9% | 2.3m | 56% | 3.89 | — |
| `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 …` | 15 | 1.5% | 22.7m | 47% | 2.40 | — |
| `radio.net 5.11.10 (iPhone; iPhone OS 26.5.2; en_DE)` | 15 | 1.5% | 0s | 100% | 1.07 | — |
| `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebK…` | 13 | 1.3% | 4s | 100% | 0.73 | — |
| `Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:152.0) G…` | 12 | 1.2% | 31.9m | 33% | 1.57 | — |
| `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebK…` | 12 | 1.2% | 37s | 67% | 1.39 | — |
| `KalishaRadio/2.0` ⏱ | 11 | 1.1% | 0s | 100% | 0.00 | 24.01h |

⏱ = near-constant arrival interval; treat as automated until proven otherwise.

## By local hour

Feeds the daypart matrix, which currently runs on *assumed* propensity curves
(FORMAT-WORKFLOW Phase 5, step 30). These are measurements.

| hour | conns | bail % | median | survivor median |
|---|---|---|---|---|
| 00 | 33 | 91% | 0s | 2.46h |
| 01 | 21 | 86% | 1s | 1.30h |
| 02 | 31 | 97% | 0s | 18.9m |
| 03 | 16 | 94% | 0s | 22.5m |
| 04 | 56 | 84% | 1s | 24.6m |
| 05 | 36 | 83% | 1s | 1.04h |
| 06 | 13 | 100% | 0s | — |
| 07 | 16 | 100% | 0s | — |
| 08 | 35 | 74% | 4s | 12.8m |
| 09 | 23 | 91% | 0s | 1.17h |
| 10 | 84 | 83% | 6s | 15.1m |
| 11 | 29 | 79% | 2s | 44.9m |
| 12 | 47 | 89% | 2s | 35.0m |
| 13 | 28 | 71% | 2s | 38.1m |
| 14 | 36 | 72% | 2s | 24.1m |
| 15 | 33 | 45% | 8.3m | 48.6m |
| 16 | 31 | 77% | 3s | 32.1m |
| 17 | 33 | 85% | 1s | 40.9m |
| 18 | 25 | 76% | 1s | 1.08h |
| 19 | 84 | 88% | 12s | 19.8m |
| 20 | 66 | 94% | 0s | 1.09h |
| 21 | 86 | 86% | 0s | 25.4m |
| 22 | 40 | 95% | 0s | 1.96h |
| 23 | 69 | 91% | 0s | 58.4m |

## By day of week

| day | conns | bail % | survivor median |
|---|---|---|---|
| Mon | 80 | 84% | 48.0m |
| Tue | 101 | 72% | 35.2m |
| Wed | 224 | 89% | 25.9m |
| Thu | 130 | 88% | 22.1m |
| Fri | 137 | 82% | 1.07h |
| Sat | 150 | 86% | 34.0m |
| Sun | 149 | 86% | 58.4m |

## By mount

| mount | conns | bail % | survivor median |
|---|---|---|---|
| `/stream` | 686 | 80% | 48.0m |
| `/` | 166 | 100% | — |
| `/favicon.ico` | 66 | 100% | — |
| `/stream-plus` | 38 | 82% | 10.0m |
| `/stream-master` | 13 | 62% | 9.9m |
| `/style.css` | 1 | 100% | — |
| `/images/tunein.png` | 1 | 100% | — |

## Repeat clients

- Distinct client fingerprints: **366**
- Connected exactly once: **261** (71.3%)
- Connected 5+ times: **28**

> Addresses are salted and hashed; the salt is per-run, so fingerprints are not
> comparable across runs and cannot be reversed. Treat these as a **floor** on
> distinct listeners and a **ceiling** on repeat rate: CGNAT and mobile carriers
> collapse many people onto one address, and dynamic IPs split one person across
> several.

## Rejected connections

Requests to an audio mount that never received audio. **These are acquisition
losses, not listeners** — somebody tried to tune in and got nothing. A directory
listing pointed at a mount that does not exist will show up here and nowhere
else, because a 404 never becomes a session.

| mount | status | count | share of failures |
|---|---|---|---|
| `/radio.mp3` | 404 | 5,009 | 72% |
| `/stream-plus` | 401 | 466 | 7% |
| `/stream-master` | 401 | 459 | 7% |
| `/stream` | 401 | 452 | 6% |
| `/stream` | 404 | 133 | 2% |
| `/stream-plus` | 403 | 46 | 1% |
| `/stream-master` | 403 | 46 | 1% |
| `/stream` | 403 | 25 | 0% |
| `/` | 501 | 22 | 0% |
| `/mcp` | 501 | 17 | 0% |

**By client** — a human user agent here is a lost listener, not a bot:

| user agent | count |
|---|---|
| `Lavf/60.16.100` | 4,467 |
| `Thimeo Streamer` | 1,494 |
| `TuneIn-DirMon/1.0` | 475 |
| `Mozilla/5.0` | 117 |
| `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebK…` | 112 |
| `Mozilla/5.0 (compatible; Infrawatch/1.0; +https://i…` | 48 |
| `python-requests/2.27.1` | 43 |
| `Mozilla/5.0 (compatible; CensysInspect/1.1; +https:…` | 32 |
| `Python/3.10 aiohttp/3.11.11` | 25 |
| `Go-http-client/1.1` | 19 |

## What this digest cannot tell you

1. **Why anyone left.** Tune-out is correlational. Someone leaving during a song
   did not necessarily leave because of it — commutes end regardless of what is
   playing. Attribution needs the join against `play_history`, daypart
   normalisation, and a minimum-plays floor before it drives any drop decision.
2. **Geography.** Not in the access log. Needs IP→geo enrichment, which is the
   one thing the AzuraCast API adds that this file does not.
3. **Which song was playing.** Same — requires the reconciliation step.
4. **Whether a bail was a rejection.** A listener who samples the stream for two
   seconds from a directory listing behaves identically to a failed connection.
