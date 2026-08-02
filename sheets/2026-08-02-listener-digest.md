# Listener session digest

- Window: **2026-07-15 → 2026-08-02** (18 days)
- Log lines: **825,342** (789,703 infrastructure, excluded)
- **Sessions: 28,661** (1604/day)
- Failed audio requests: **6,978** — see *Rejected connections*
- Local hours reported at UTC-7

## Automation separation

| | sessions | share | distinct IPs |
|---|---|---|---|
| Automated | 27,331 | 95.4% | 245 |
| **Human (residual)** | 1,330 | 4.6% | 368 |

> **The human set is a residual, not a clean population.** Everything not
> positively identified as automated lands in it, so its bail rate is an *upper*
> bound and its survivor share a *lower* bound. The true audience is at least
> this good and probably better.

| user agent | sessions | IPs | req/IP | verdict |
|---|---|---|---|---|
| `Mozilla/5.0 (Windows NT 10.0; Win64; x64) A…` | 14,714 | 2 | 7357 | auto — concentration |
| `Mozilla/5.0` | 11,438 | 9 | 1271 | auto — named |
| `python-requests/2.27.1` | 264 | 31 | 9 | auto — named |
| `Mozilla/5.0 (Linux; Android 10; K) AppleWeb…` | 186 | 12 | 16 | human |
| `Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 lik…` | 157 | 3 | 52 | human |
| `TARV-RadioDiscovery/2.0.0 (+metadata-only n…` | 146 | 1 | 146 | auto — named |
| `Mozilla/5.0 (compatible; FlowIQLabsBot/1.0;…` | 122 | 23 | 5 | auto — named |
| `mrtscan/1.0 (westus)` | 119 | 16 | 7 | auto — named |
| `ORB HisBot/26b72 (http://onlineradiobox.com…` | 97 | 2 | 48 | auto — named |
| `Mozilla/5.0 (iPhone; CPU iPhone OS 27_0_0 l…` | 83 | 8 | 10 | human |
| `Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:…` | 78 | 2 | 39 | human |
| `Mozilla/5.0 (compatible; CensysInspect/1.1;…` | 63 | 30 | 2 | auto — named |
| `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit…` | 63 | 3 | 21 | human |
| `-` | 59 | 49 | 1 | auto — named |
| `visionheight.com/scan Mozilla/5.0 (Macintos…` | 57 | 5 | 11 | auto — named |

**Everything below is the human residual only.**

## Bail vs stay

**The distribution is bimodal.** Two modes at ~**3s** and ~**1.08h**, separated by a trough at **7.3m** (dip depth 41%).

The trough is the *derived* bail threshold — read off the data rather than
assumed. Assuming 60s would have baked the hypothesis into the answer.

| | count | share |
|---|---|---|
| **Bailed** (< 7.3m) | 1,068 | **80.3%** |
| **Stayed** (≥ 7.3m) | 262 | **19.7%** |

**Conditional TSL of survivors** — median **50.0m**, mean **3.60h**, p90 **2.46h**.

Mean across *all* sessions is 42.9m — reported only to be dismissed. In a bimodal population the mean describes a
duration almost nobody experiences. Bail rate and conditional TSL are the honest
pair.

### Fixed reference cuts

| under | count | share |
|---|---|---|
| 5s | 682 | 51.3% |
| 10s | 767 | 57.7% |
| 30s | 876 | 65.9% |
| 1.0m | 940 | 70.7% |
| 5.0m | 1,048 | 78.8% |
| 30.0m | 1,168 | 87.8% |

### Distribution

```
     1s | ████████████████████████████████████████     141
     2s |                                                0
     2s | ███████████████                               53
     3s | ██████████████                                52
     4s | ███████                                       28
     6s | █████████████                                 48
     8s | ████████                                      29
    10s | ████████████                                  45
    14s | ██████                                        24
    19s | ██████                                        24
    26s | ███████                                       28
    36s | ████████                                      31
    49s | ███████                                       25
   1.1m | ██████                                        24
   1.5m | █████                                         18
   2.1m | █████                                         18
   2.9m | ███████                                       25
   3.9m | ███████                                       25
   5.3m | ███                                           13
   7.3m | ██████                                        23
   9.9m | █████                                         19
  13.6m | █████                                         20
  18.5m | ███████                                       25
  25.3m | █████                                         21
  34.6m | ██████                                        23
  47.3m | █████                                         20
  1.08h | ████████████                                  44
  1.47h | ████████                                      30
  2.01h | ████                                          17
  2.74h | ██                                             9
  3.74h | █                                              4
  5.11h |                                                2
  6.98h |                                                0
  9.54h |                                                1
 13.03h |                                                0
 17.79h |                                                0
 24.30h |                                                3
 33.19h |                                                1
 45.34h |                                                1
 61.92h | ██                                             8
```

## User agents

Scrapers are **detected, not assumed**. A short session is not evidence of a bot;
a *regular* one is. Low gap-variance (CV) means connections arrive on a timer,
which is what a directory health-check looks like and what a human never does.

| user agent | conns | share | median | bail % | gap CV | every |
|---|---|---|---|---|---|---|
| `Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.…` | 186 | 14.0% | 7s | 95% | 3.22 | — |
| `Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS…` | 157 | 11.8% | 30s | 73% | 3.79 | — |
| `Mozilla/5.0 (iPhone; CPU iPhone OS 27_0_0 like Mac …` | 83 | 6.2% | 37.9m | 22% | 2.14 | — |
| `Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:152.0) G…` | 78 | 5.9% | 4.7m | 56% | 1.89 | — |
| `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 …` | 63 | 4.7% | 4.7m | 51% | 1.43 | — |
| `Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS…` | 48 | 3.6% | 15.5m | 38% | 1.59 | — |
| `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebK…` | 36 | 2.7% | 0s | 100% | 1.00 | — |
| `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebK…` | 35 | 2.6% | 0s | 100% | 2.80 | — |
| `Mozilla/5.0 (compatible; Infrawatch/1.0; +https://i…` | 32 | 2.4% | 0s | 100% | 0.73 | — |
| `Mozilla/5.0 zgrab/0.x` | 30 | 2.3% | 0s | 100% | 0.77 | — |
| `Thimeo Streamer` | 27 | 2.0% | 2.03h | 26% | 1.34 | — |
| `Espiker/0.1 (contact@espiker.com)` | 22 | 1.7% | 0s | 100% | 0.63 | — |
| `VLC/3.0.23 LibVLC/3.0.23` | 21 | 1.6% | 2.4m | 57% | 3.86 | — |
| `Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:134.0) G…` | 20 | 1.5% | 3s | 100% | 1.46 | — |
| `Mozilla/5.0 (Macintosh; Intel Mac OS X 13_1) AppleW…` | 20 | 1.5% | 0s | 100% | 1.81 | — |
| `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) App…` | 20 | 1.5% | 50s | 95% | 0.60 | — |
| `radio-collector/1.0` | 19 | 1.4% | 1s | 100% | 0.75 | — |
| `radio.net 5.11.10 (iPhone; iPhone OS 26.5.2; en_DE)` | 15 | 1.1% | 0s | 100% | 1.07 | — |
| `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebK…` | 13 | 1.0% | 4s | 100% | 0.73 | — |
| `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebK…` | 12 | 0.9% | 37s | 67% | 1.39 | — |

⏱ = near-constant arrival interval; treat as automated until proven otherwise.

## By local hour

Feeds the daypart matrix, which currently runs on *assumed* propensity curves
(FORMAT-WORKFLOW Phase 5, step 30). These are measurements.

| hour | conns | bail % | median | survivor median |
|---|---|---|---|---|
| 00 | 38 | 82% | 0s | 2.20h |
| 01 | 28 | 86% | 2s | 43.9m |
| 02 | 39 | 85% | 1s | 2.56h |
| 03 | 25 | 80% | 5s | 1.54h |
| 04 | 71 | 83% | 1s | 20.5m |
| 05 | 43 | 77% | 1s | 1.03h |
| 06 | 22 | 82% | 6s | 58.6m |
| 07 | 36 | 89% | 4s | 1.19h |
| 08 | 45 | 69% | 17s | 19.0m |
| 09 | 31 | 68% | 3s | 51.8m |
| 10 | 103 | 79% | 7s | 45.4m |
| 11 | 67 | 90% | 5s | 38.8m |
| 12 | 76 | 70% | 10s | 2.02h |
| 13 | 45 | 76% | 50s | 54.6m |
| 14 | 61 | 72% | 9s | 23.5m |
| 15 | 52 | 50% | 5.8m | 35.8m |
| 16 | 53 | 81% | 1.1m | 32.1m |
| 17 | 55 | 73% | 28s | 28.3m |
| 18 | 31 | 61% | 17s | 34.2m |
| 19 | 98 | 92% | 12s | 53.8m |
| 20 | 83 | 92% | 0s | 39.9m |
| 21 | 115 | 84% | 2s | 36.7m |
| 22 | 40 | 95% | 0s | 1.96h |
| 23 | 73 | 89% | 0s | 58.4m |

## By day of week

| day | conns | bail % | survivor median |
|---|---|---|---|
| Mon | 90 | 77% | 40.9m |
| Tue | 128 | 77% | 1.04h |
| Wed | 310 | 85% | 50.0m |
| Thu | 240 | 75% | 28.2m |
| Fri | 174 | 78% | 1.01h |
| Sat | 180 | 82% | 57.6m |
| Sun | 208 | 84% | 1.03h |

## By mount

| mount | conns | bail % | survivor median |
|---|---|---|---|
| `/stream` | 985 | 76% | 50.0m |
| `/` | 166 | 100% | — |
| `/favicon.ico` | 66 | 100% | — |
| `/stream-plus` | 59 | 75% | 40.3m |
| `/stream-master` | 41 | 66% | 1.34h |
| `/style.css` | 9 | 100% | — |
| `/images/tunein.png` | 1 | 100% | — |
| `/admin.html` | 1 | 100% | — |
| `/adminbar.html` | 1 | 100% | — |
| `/images/icecast.png` | 1 | 100% | — |

## Repeat clients

- Distinct client fingerprints: **368**
- Connected exactly once: **261** (70.9%)
- Connected 5+ times: **30**

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
| `/stream` | 404 | 141 | 2% |
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
