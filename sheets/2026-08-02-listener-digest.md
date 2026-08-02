# Listener session digest

- Window: **2026-07-15 → 2026-08-02** (18 days)
- Log lines: **824,992** (790,506 infrastructure, excluded)
- **Sessions: 27,460** (1537/day)
- Failed audio requests: **6,900** — see *Rejected connections*
- Local hours reported at UTC-7

## Automation separation

| | sessions | share | distinct IPs |
|---|---|---|---|
| Automated | 26,802 | 97.6% | 66 |
| **Human (residual)** | 658 | 2.4% | 147 |

> **The human set is a residual, not a clean population.** Everything not
> positively identified as automated lands in it, so its bail rate is an *upper*
> bound and its survivor share a *lower* bound. The true audience is at least
> this good and probably better.

| user agent | sessions | IPs | req/IP | verdict |
|---|---|---|---|---|
| `Mozilla/5.0 (Windows NT 10.0; Win64; x64) A…` | 14,714 | 2 | 7357 | auto — concentration |
| `Mozilla/5.0` | 11,431 | 6 | 1905 | auto — named |
| `python-requests/2.27.1` | 264 | 31 | 9 | auto — named |
| `TARV-RadioDiscovery/2.0.0 (+metadata-only n…` | 146 | 1 | 146 | auto — named |
| `Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 lik…` | 106 | 2 | 53 | human |
| `ORB HisBot/26b72 (http://onlineradiobox.com…` | 97 | 2 | 48 | auto — named |
| `Mozilla/5.0 (Linux; Android 10; K) AppleWeb…` | 64 | 11 | 6 | human |
| `Mozilla/5.0 (iPhone; CPU iPhone OS 27_0_0 l…` | 54 | 7 | 8 | human |
| `Python/3.14 aiohttp/3.14.3` | 46 | 1 | 46 | auto — named |
| `Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 lik…` | 41 | 4 | 10 | human |
| `Mozilla/5.0 (Windows NT 10.0; Win64; x64) A…` | 33 | 1 | 33 | human |
| `AllM-Prober/1.0` | 23 | 1 | 23 | auto — named |
| `Espiker/0.1 (contact@espiker.com)` | 22 | 2 | 11 | human |
| `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_1…` | 20 | 1 | 20 | human |
| `radio-collector/1.0` | 19 | 2 | 10 | human |

### Listening-hour concentration

Which addresses own the listening time. A relay or an insider at the top of this
table invalidates every aggregate above it, and neither is caught by
volume-based detection — a relay makes very few, very long connections.

Human listening: **131h** across **147** addresses.

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

**The distribution is bimodal.** Two modes at ~**13s** and ~**1.33h**, separated by a trough at **2.0m** (dip depth 75%).

The trough is the *derived* bail threshold — read off the data rather than
assumed. Assuming 60s would have baked the hypothesis into the answer.

| | count | share |
|---|---|---|
| **Bailed** (< 2.0m) | 475 | **72.2%** |
| **Stayed** (≥ 2.0m) | 183 | **27.8%** |

### Robust dispersion, per mode

Reported as median / IQR / MAD rather than mean and standard deviation. A
bimodal, heavy-tailed population has **no single valid location-and-spread
pair** — any figure spanning both modes describes a duration nobody experiences.
So each mode is summarised separately, and the mean is shown only to be
dismissed.

| mode | n | median | IQR | MAD | mean |
|---|---|---|---|---|---|
| Bailed | 475 | **2s** | 0s – 12s | 2s | 10s |
| **Stayed** | 183 | **23.5m** | 7.1m – 1.08h | 20.4m | 42.4m |

**Survivor TSL: median 23.5m, IQR 7.1m – 1.08h.**
Its mean (42.4m) is 1.8× the median — a ratio near 1 means the tail
is no longer dominating; a large one means contamination remains.

### How well determined are these?

| statistic | value | SE | 95% CI |
|---|---|---|---|
| survivor median | 23.5m | 3.5m | 17.8m – 32.1m |
| survivor mean | 42.4m | 3.5m | 35.8m – 49.4m |
| survivor share | 27.8% | 1.7% | 24.4% – 31.2% |

> **The share is the well-determined figure; the TSL is not.** Quote the
> interval, not the point estimate, and do not build on a difference
> smaller than the SE. Precision here is bounded by the number of
> survivors (183), which only more weeks can fix.

> Note: the **mean is the more precise estimator here** — the median
> sits in a sparse region of this distribution. The median remains the
> right choice against *contamination*; the mean is the more efficient
> one once contamination is removed. Different jobs.

### Fixed reference cuts

| under | count | share |
|---|---|---|
| 5s | 290 | 44.1% |
| 10s | 339 | 51.5% |
| 30s | 413 | 62.8% |
| 1.0m | 458 | 69.6% |
| 5.0m | 511 | 77.7% |
| 30.0m | 576 | 87.5% |

### Distribution

```
     1s | ████████████████████████████████████████     108
     1s |                                                0
     2s | ████████████                                  35
     2s |                                                0
     3s | ████                                          13
     4s | ████                                          13
     5s | ████                                          13
     6s | ████████                                      24
     8s | ████                                          12
    10s | █████                                         16
    13s | ██████                                        17
    17s | ████████                                      23
    22s | ██                                             8
    28s | █████                                         16
    35s | ██████                                        18
    45s | █████                                         15
    58s | ████                                          12
   1.2m | ███                                            9
   1.6m |                                                1
   2.0m | ██                                             6
   2.6m | █                                              5
   3.3m | ██████                                        17
   4.2m | ███                                            9
   5.4m | ██                                             6
   6.8m | ███                                           10
   8.7m | ██                                             7
  11.2m | ████                                          11
  14.3m | ██                                             6
  18.3m | ███                                           10
  23.4m | █████                                         14
  29.9m | █                                              5
  38.2m | ██                                             8
  48.8m | ███                                            9
  1.04h | █████████                                     25
  1.33h | ████                                          12
  1.70h | ████                                          11
  2.17h | ██                                             7
  2.78h | █                                              3
  3.55h |                                                2
  4.54h |                                                1
```

## User agents

Scrapers are **detected, not assumed**. A short session is not evidence of a bot;
a *regular* one is. Low gap-variance (CV) means connections arrive on a timer,
which is what a directory health-check looks like and what a human never does.

| user agent | conns | share | median | bail % | gap CV | every |
|---|---|---|---|---|---|---|
| `Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS…` | 106 | 16.1% | 26s | 67% | 3.52 | — |
| `Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.…` | 64 | 9.7% | 6s | 94% | 2.66 | — |
| `Mozilla/5.0 (iPhone; CPU iPhone OS 27_0_0 like Mac …` | 54 | 8.2% | 50.0m | 6% | 1.70 | — |
| `Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS…` | 41 | 6.2% | 20.6m | 10% | 1.78 | — |
| `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebK…` ⏱ | 33 | 5.0% | 0s | 100% | 0.18 | 2.98h |
| `Espiker/0.1 (contact@espiker.com)` | 22 | 3.3% | 0s | 100% | 0.63 | — |
| `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) App…` | 20 | 3.0% | 50s | 85% | 0.60 | — |
| `radio-collector/1.0` | 19 | 2.9% | 1s | 100% | 0.75 | — |
| `VLC/3.0.23 LibVLC/3.0.23` | 18 | 2.7% | 2.3m | 44% | 3.89 | — |
| `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 …` | 15 | 2.3% | 22.7m | 20% | 2.40 | — |
| `radio.net 5.11.10 (iPhone; iPhone OS 26.5.2; en_DE)` | 15 | 2.3% | 0s | 100% | 1.07 | — |
| `Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:152.0) G…` | 12 | 1.8% | 31.9m | 33% | 1.57 | — |
| `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebK…` | 12 | 1.8% | 37s | 58% | 1.39 | — |
| `KalishaRadio/2.0` ⏱ | 11 | 1.7% | 0s | 100% | 0.00 | 24.01h |
| `RadioAPI/1.0` ⏱ | 11 | 1.7% | 0s | 100% | 0.00 | 24.03h |
| `radio.de 5.11.8 (iPhone; iPhone OS 26.5.2; de_DE)` | 11 | 1.7% | 1s | 100% | 1.52 | — |
| `AuraRadio/0.1 (Android)` ⏱ | 10 | 1.5% | 1s | 100% | 0.02 | 12.09h |
| `Mozilla/5.0 (iPhone; CPU iPhone OS 13_2_3 like Mac …` | 9 | 1.4% | 1s | 100% | 1.63 | — |
| `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebK…` ⏱ | 8 | 1.2% | 4s | 100% | 0.06 | 35.57h |
| `VLC/3.0.16` ⏱ | 8 | 1.2% | 1s | 100% | 0.01 | 6.6m |

⏱ = near-constant arrival interval; treat as automated until proven otherwise.

## By local hour

Feeds the daypart matrix, which currently runs on *assumed* propensity curves
(FORMAT-WORKFLOW Phase 5, step 30). These are measurements.

| hour | conns | bail % | median | survivor median |
|---|---|---|---|---|
| 00 | 14 | 71% | 1s | 1.30h |
| 01 | 15 | 80% | 2s | 1.30h |
| 02 | 16 | 88% | 1s | 11.5m |
| 03 | 11 | 91% | 9s | 22.5m |
| 04 | 43 | 79% | 1s | 24.6m |
| 05 | 28 | 75% | 1s | 1.04h |
| 06 | 5 | 100% | 1s | — |
| 07 | 9 | 100% | 5s | — |
| 08 | 28 | 64% | 16s | 9.8m |
| 09 | 18 | 83% | 1s | 1.17h |
| 10 | 78 | 81% | 7s | 14.7m |
| 11 | 23 | 57% | 5s | 20.4m |
| 12 | 34 | 71% | 5s | 5.8m |
| 13 | 25 | 60% | 7s | 24.8m |
| 14 | 22 | 41% | 4.2m | 23.5m |
| 15 | 28 | 32% | 16.3m | 35.3m |
| 16 | 25 | 44% | 3.0m | 7.6m |
| 17 | 17 | 65% | 28s | 28.9m |
| 18 | 20 | 60% | 10s | 52.4m |
| 19 | 78 | 81% | 14s | 7.2m |
| 20 | 35 | 89% | 1s | 1.09h |
| 21 | 54 | 78% | 1s | 25.4m |
| 22 | 8 | 75% | 30s | 1.96h |
| 23 | 24 | 75% | 2s | 58.4m |

## By day of week

| day | conns | bail % | survivor median |
|---|---|---|---|
| Mon | 45 | 69% | 44.5m |
| Tue | 62 | 34% | 9.9m |
| Wed | 178 | 83% | 19.4m |
| Thu | 80 | 74% | 17.8m |
| Fri | 91 | 70% | 51.0m |
| Sat | 86 | 71% | 24.7m |
| Sun | 116 | 78% | 29.9m |

## By mount

| mount | conns | bail % | survivor median |
|---|---|---|---|
| `/stream` | 616 | 73% | 25.4m |
| `/stream-plus` | 29 | 72% | 10.0m |
| `/stream-master` | 13 | 54% | 8.7m |

## Repeat clients

- Distinct client fingerprints: **147**
- Connected exactly once: **86** (58.5%)
- Connected 5+ times: **26**

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
| `/radio.mp3` | 404 | 5,009 | 73% |
| `/stream-plus` | 401 | 466 | 7% |
| `/stream-master` | 401 | 459 | 7% |
| `/stream` | 401 | 452 | 7% |
| `/stream` | 404 | 133 | 2% |
| `/stream-plus` | 403 | 46 | 1% |
| `/stream-master` | 403 | 46 | 1% |
| `/stream` | 403 | 25 | 0% |
| `/mcp` | 501 | 17 | 0% |
| `/sse` | 404 | 17 | 0% |

**By client** — a human user agent here is a lost listener, not a bot:

| user agent | count |
|---|---|
| `Lavf/60.16.100` | 4,467 |
| `Thimeo Streamer` | 1,494 |
| `TuneIn-DirMon/1.0` | 475 |
| `Mozilla/5.0` | 115 |
| `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebK…` | 104 |
| `python-requests/2.27.1` | 43 |
| `Mozilla/5.0 (compatible; Infrawatch/1.0; +https://i…` | 32 |
| `Python/3.10 aiohttp/3.11.11` | 25 |
| `Go-http-client/1.1` | 16 |
| `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebK…` | 14 |

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
