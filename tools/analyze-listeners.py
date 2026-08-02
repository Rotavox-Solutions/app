#!/usr/bin/env python3
"""
Listener session analysis from Icecast access logs.

Runs on the AzuraCast host. Reads only; makes zero network calls; never writes to any
database; never modifies the logs. Emits a markdown digest to stdout or --out.

WHY THE LOG AND NOT THE API
---------------------------
AzuraCast's listener table is built by polling the broadcast backend on an interval and
diffing the result. That makes it a *sampler*: sessions shorter than the poll interval
can vanish entirely, and every duration is quantised to the interval. If the question is
"what fraction of connections die in the first few seconds", a sampler is blind to
precisely the population being measured.

The Icecast access log is *event-driven*: one line per connection, written at disconnect,
carrying the duration in seconds. A 4-second session is recorded as a 4-second session.
It is the only source that yields both a numerator (short sessions) and a denominator
(total connections), and a bail *rate* needs both.

INVARIANT #1 — INTROSPECT, DON'T HARDCODE
------------------------------------------
Log format varies by Icecast build, by AzuraCast version, and by whether a proxy sits in
front. This script detects the format, reports what it detected, and refuses to compute
duration statistics if it cannot positively identify a duration field. It does not
silently fall back to a guess -- a fabricated bail rate is worse than no bail rate.

Run --inspect first. It answers "what can this instrument actually see" before anything
is built on top of it.

PRIVACY
-------
The digest is designed to be committed to the repo. Raw IPs are never emitted. Where
per-client analysis is needed (repeat visitors), addresses are salted and hashed, and
only aggregates are printed.

USAGE
-----
    python3 tools/analyze-listeners.py --inspect  /path/to/access.log
    python3 tools/analyze-listeners.py --report   /path/to/access.log[.gz] [more...]
    python3 tools/analyze-listeners.py --report   /path/to/logdir --tz -5 --out digest.md

Accepts plain and .gz files, and directories (searched for access*.log*).
"""

import argparse
import gzip
import hashlib
import math
import os
import re
import random
import secrets
import sys
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone

# --------------------------------------------------------------------------------------
# Parsing
# --------------------------------------------------------------------------------------

MONTHS = {m: i for i, m in enumerate(
    "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(), start=1)}

# NCSA combined, with Icecast's trailing duration-in-seconds extension. The trailing
# field is optional in the pattern so that a plain combined log still parses -- we detect
# its absence and report it rather than failing to read the file at all.
LINE_RE = re.compile(
    r'^(?P<host>\S+) \S+ (?P<user>\S+) '
    r'\[(?P<ts>[^\]]+)\] '
    r'"(?P<request>[^"]*)" '
    r'(?P<status>\d{3}) (?P<bytes>\S+)'
    r'(?: "(?P<referer>[^"]*)" "(?P<agent>[^"]*)")?'
    r'(?P<rest>.*)$'
)

TS_RE = re.compile(r'^(\d{2})/(\w{3})/(\d{4}):(\d{2}):(\d{2}):(\d{2})\s*([+-]\d{4})?$')

# Icecast logs every request, not just listener connections. On a live AzuraCast host the
# overwhelming majority of lines are its own internal polling -- /admin/listclients and
# /admin/stats, which is the sampler that makes the API unsuitable for this question in
# the first place. Counting those as connections would manufacture a huge bail rate out
# of infrastructure traffic, since they all carry duration 0.
INFRA_RE = re.compile(
    r'^/(admin/|status-json|status\.xsl)|\.(xspf|m3u|m3u8|pls|xsl)$', re.I)

# Only these mean "a client actually received audio". 206 is a range request, which some
# players use for the initial connection; it is a real session.
SESSION_STATUS = ("200", "206")

# A listener GETs. An encoder SOURCEs or PUTs, and Icecast logs the source connection's
# duration in the very same field -- so a StereoTool/Liquidsoap feed that holds the mount
# for three days looks exactly like a listener with a 72-hour session unless method is
# checked. This is a structural filter and belongs ahead of every heuristic below.
SESSION_METHOD = ("GET",)


def classify(mount):
    """audio | infra | other -- 'other' covers OPTIONS '*' and malformed requests."""
    if not mount.startswith("/"):
        return "other"
    return "infra" if INFRA_RE.search(mount) else "audio"


def sessions_of(rows):
    """The subset that represents a client connecting to a mount and receiving audio."""
    return [r for r in rows
            if r.method in SESSION_METHOD and r.kind == "audio"
            and r.status in SESSION_STATUS and r.duration is not None]


BOT_UA_RE = re.compile(
    r'python-requests|aiohttp|Censys|Palo Alto|mrtscan|FlowIQ|visionheight|TARV-|HisBot|'
    r'Lavf/|DirMon|Go-http|curl|wget|Scrapy|bot\b|spider|scan|probe|monitor|check|'
    r'Thimeo|Streamer|StreamS|Icecast|liquidsoap|butt/|Mixxx|'
    r'^-$|^Mozilla/5\.0$', re.I)

# Backstop only. The primary defence against encoder connections is SESSION_METHOD above:
# on The BOLT's first corpus a StereoTool feed logged SOURCE connections of 260,523s
# (72.4h) each, which were counted as listeners and became 75% of all apparent listening
# hours. Method filtering removes those structurally. This ceiling remains for anything
# that GETs a mount and never lets go.
MAX_PLAUSIBLE_SESSION_H = 12

# A single machine cannot be a meaningful share of an audience. Requests-per-distinct-IP
# is the strongest available bot discriminator on this data: real listeners spread across
# many addresses at a handful of sessions each, while a scanner concentrates thousands of
# requests onto one or two hosts.
#
# Gap-variance (periodicity) was tried first and is NOT sufficient on its own -- the two
# largest scanners on The BOLT's log arrive irregularly (CV 7.8 and 32.1) and would pass
# a timing test while accounting for 91% of all sessions. Concentration caught both.
# A trough is only a mode boundary if it is deep. On a small corpus the smoothed
# histogram always has shallow local minima, and treating one as a bail threshold
# invents a split that is not there. Below this depth the script says so and falls back
# to a stated convention rather than dressing a convention up as a derived value.
MIN_DIP_RATIO = 0.35

CONC_MIN_REQUESTS = 200
CONC_PER_IP = 50


def split_traffic(sess):
    """(human, automated, per-UA diagnostics). Classification is heuristic and stated as
    such wherever it is reported -- the residual 'human' set is an upper bound on
    automation, never a clean population."""
    by_ua_ips, by_ua = defaultdict(set), defaultdict(list)
    for r in sess:
        by_ua_ips[r.agent].add(r.ip)
        by_ua[r.agent].append(r)

    human, auto, diag = [], [], []
    for ua, rs in by_ua.items():
        ips = len(by_ua_ips[ua])
        conc = len(rs) / max(1, ips)
        named = bool(BOT_UA_RE.search(ua or "-"))
        concentrated = len(rs) >= CONC_MIN_REQUESTS and conc >= CONC_PER_IP
        # A relay is identifiable by holding the mount far longer than any person does.
        marathon = (percentile(sorted(r.duration for r in rs), .5)
                    > MAX_PLAUSIBLE_SESSION_H * 3600)
        is_bot = named or concentrated or marathon
        reason = ("named" if named else
                  "concentration" if concentrated else
                  "session length" if marathon else "")
        diag.append((ua, len(rs), ips, conc, is_bot, reason))
        (auto if is_bot else human).extend(rs)
    diag.sort(key=lambda t: t[1], reverse=True)
    return human, auto, diag


def bootstrap_ci(ds, stat, n=4000, seed=17):
    """Standard error and 95% interval for a statistic, by resampling.

    A point estimate quoted without this is a claim of precision nobody checked. On The
    BOLT's first corpus the survivor median carried SE 7.8m against a value of 37.5m --
    the figure is real, but soft, and no decision should hinge on 37 versus 45.
    """
    if len(ds) < 20:
        return None
    rng = random.Random(seed)
    vals = sorted(stat(sorted(rng.choices(ds, k=len(ds)))) for _ in range(n))
    mean = sum(vals) / len(vals)
    var = sum((v - mean) ** 2 for v in vals) / (len(vals) - 1)
    return {"se": math.sqrt(var), "lo": vals[int(.025 * len(vals))],
            "hi": vals[int(.975 * len(vals))]}


def robust_stats(ds):
    """Median, IQR and MAD. Deliberately NOT mean and standard deviation.

    Session length is heavy-tailed: on the first BOLT corpus the arithmetic mean moved
    by 5x (42.9m -> 8.1m) when two addresses were removed, while the median of the
    survivor mode barely moved at all (40.2m -> 37.5m). The mean is not a summary of
    this data, it is a summary of its largest outlier.
    """
    d = sorted(ds)
    if len(d) < 8:
        return None
    med = percentile(d, .5)
    mad = percentile(sorted(abs(x - med) for x in d), .5)
    return {"n": len(d), "median": med, "q1": percentile(d, .25),
            "q3": percentile(d, .75), "mad": mad, "rsd": 1.4826 * mad,
            "mean": sum(d) / len(d)}


def parse_ts(s):
    m = TS_RE.match(s.strip())
    if not m:
        return None
    d, mon, y, hh, mm, ss, off = m.groups()
    if mon not in MONTHS:
        return None
    tz = timezone.utc
    if off:
        sign = 1 if off[0] == '+' else -1
        tz = timezone(sign * timedelta(hours=int(off[1:3]), minutes=int(off[3:5])))
    try:
        return datetime(int(y), MONTHS[mon], int(d), int(hh), int(mm), int(ss), tzinfo=tz)
    except ValueError:
        return None


class Row:
    __slots__ = ("ip", "ts", "mount", "status", "bytes", "agent", "duration", "kind",
                 "method")

    def __init__(self, ip, ts, mount, status, nbytes, agent, duration, method="GET"):
        self.ip = ip
        self.ts = ts
        self.mount = mount
        self.status = status
        self.bytes = nbytes
        self.agent = agent
        self.duration = duration
        self.kind = classify(mount)
        self.method = method


def parse_line(line):
    """Return (Row, trailing_fields) or (None, reason)."""
    m = LINE_RE.match(line.rstrip("\n"))
    if not m:
        return None, "no-match"
    ts = parse_ts(m.group("ts"))
    if ts is None:
        return None, "bad-timestamp"

    request = m.group("request") or ""
    parts = request.split()
    # AzuraCast appends a cache-busting query (?&_ic2=1); strip it so one mount is one
    # mount rather than a long tail of near-duplicates.
    mount = parts[1].split("?", 1)[0] if len(parts) >= 2 else "?"
    method = parts[0].upper() if parts else "?"

    try:
        nbytes = int(m.group("bytes"))
    except (TypeError, ValueError):
        nbytes = 0

    trailing = (m.group("rest") or "").split()
    # Icecast appends connection duration in whole seconds as the final field. Take the
    # LAST integer-looking trailing token rather than the first, so an extra field
    # inserted by a proxy or a newer AzuraCast build does not get read as the duration.
    duration = None
    for tok in reversed(trailing):
        if re.fullmatch(r"\d+", tok):
            duration = int(tok)
            break

    return Row(m.group("host"), ts, mount, m.group("status"), nbytes,
               m.group("agent") or "", duration, method), trailing


def iter_files(paths):
    for p in paths:
        if os.path.isdir(p):
            for name in sorted(os.listdir(p)):
                if re.match(r"access.*\.log", name):
                    yield os.path.join(p, name)
        else:
            yield p


def read_rows(paths, since=None, until=None):
    rows, failures, trailing_shapes = [], Counter(), Counter()
    files_read = []
    for path in iter_files(paths):
        opener = gzip.open if path.endswith(".gz") else open
        try:
            with opener(path, "rt", errors="replace") as fh:
                n = 0
                for line in fh:
                    if not line.strip():
                        continue
                    row, extra = parse_line(line)
                    if row is None:
                        failures[extra] += 1
                        continue
                    if since and row.ts < since:
                        continue
                    if until and row.ts > until:
                        continue
                    trailing_shapes[len(extra)] += 1
                    rows.append(row)
                    n += 1
            files_read.append((path, n))
        except OSError as e:
            print(f"warning: cannot read {path}: {e}", file=sys.stderr)
    return rows, failures, trailing_shapes, files_read


# --------------------------------------------------------------------------------------
# Statistics
# --------------------------------------------------------------------------------------

def percentile(sorted_vals, q):
    if not sorted_vals:
        return None
    k = (len(sorted_vals) - 1) * q
    lo, hi = math.floor(k), math.ceil(k)
    if lo == hi:
        return sorted_vals[int(k)]
    return sorted_vals[lo] + (sorted_vals[hi] - sorted_vals[lo]) * (k - lo)


def log_histogram(durations, bins=40):
    """Histogram over log10(duration). Session length spans seconds to hours, so a
    linear histogram puts 99% of the mass in the first bucket and shows nothing."""
    vals = [math.log10(d) for d in durations if d >= 1]
    if not vals:
        return [], 0.0, 0.0
    lo, hi = min(vals), max(vals)
    if hi <= lo:
        return [(lo, len(vals))], lo, hi
    width = (hi - lo) / bins
    counts = [0] * bins
    for v in vals:
        idx = min(bins - 1, int((v - lo) / width))
        counts[idx] += 1
    return [(lo + (i + 0.5) * width, c) for i, c in enumerate(counts)], lo, hi


def smooth(counts, window=3):
    out, half = [], window // 2
    for i in range(len(counts)):
        lo, hi = max(0, i - half), min(len(counts), i + half + 1)
        out.append(sum(counts[lo:hi]) / (hi - lo))
    return out


def find_antimode(hist):
    """Locate the trough between the two largest peaks of the smoothed log-duration
    histogram. This is the empirically derived bail threshold.

    Deriving it matters: assuming 60s would bake the hypothesis into the answer. If the
    population really splits into 'bail' and 'stay', the boundary is wherever the data
    puts it -- which might be 12 seconds or 90.

    Returns (threshold_seconds, dip_ratio, peak_a_s, peak_b_s) or None when the
    distribution has no clear second mode.
    """
    if len(hist) < 8:
        return None
    centers = [c for c, _ in hist]
    ys = smooth([n for _, n in hist])

    peaks = [i for i in range(1, len(ys) - 1)
             if ys[i] >= ys[i - 1] and ys[i] >= ys[i + 1] and ys[i] > 0]
    if len(peaks) < 2:
        return None

    peaks.sort(key=lambda i: ys[i], reverse=True)
    primary = peaks[0]
    # Require the second peak to be a genuine separate mode, not the shoulder of the
    # first -- at least a fifth of the histogram away.
    min_sep = max(2, len(ys) // 5)
    secondary = next((i for i in peaks[1:] if abs(i - primary) >= min_sep), None)
    if secondary is None:
        return None

    a, b = sorted((primary, secondary))
    trough = min(range(a, b + 1), key=lambda i: ys[i])
    smaller_peak = min(ys[a], ys[b])
    if smaller_peak <= 0:
        return None
    dip_ratio = 1.0 - (ys[trough] / smaller_peak)

    return (10 ** centers[trough], dip_ratio, 10 ** centers[a], 10 ** centers[b])


def quantisation_check(durations):
    """Is this instrument event-driven or sampled?

    A sampled source quantises every duration to its poll interval, so durations cluster
    on multiples of N and nothing exists below N. An event-driven source does not. This
    is the check that tells us whether sub-minute statistics from this file are real.
    """
    nz = [d for d in durations if d > 0]
    if len(nz) < 50:
        return None
    result = {"min_nonzero": min(nz), "n": len(nz), "divisors": []}
    for n in (2, 3, 4, 5, 10, 15, 20, 30, 60):
        share = sum(1 for d in nz if d % n == 0) / len(nz)
        # Under an unquantised distribution roughly 1/n of values divide evenly by n.
        # Substantially more than that is the signature of a sampler.
        if share > min(0.85, (1.0 / n) * 4):
            result["divisors"].append((n, share))
    return result


def periodicity(timestamps):
    """Coefficient of variation of inter-arrival gaps.

    A health-check scraper connects on a timer, so its gaps are near-constant and CV is
    low. Humans arrive irregularly and CV is high. This distinguishes a monitoring bot
    from a listener who bailed -- without assuming that short means bot, which was
    explicitly rejected as an inference.
    """
    if len(timestamps) < 6:
        return None
    ts = sorted(timestamps)
    gaps = [(ts[i] - ts[i - 1]).total_seconds() for i in range(1, len(ts))]
    gaps = [g for g in gaps if g > 0]
    if len(gaps) < 5:
        return None
    mean = sum(gaps) / len(gaps)
    if mean <= 0:
        return None
    var = sum((g - mean) ** 2 for g in gaps) / len(gaps)
    return math.sqrt(var) / mean, mean


def fmt_dur(s):
    if s is None:
        return "—"
    s = float(s)
    if s < 60:
        return f"{s:.0f}s"
    if s < 3600:
        return f"{s / 60:.1f}m"
    return f"{s / 3600:.2f}h"


def mask_ip(ip):
    """Never emit a full address into a committed digest."""
    if ":" in ip:
        return ":".join(ip.split(":")[:2]) + "::/32"
    parts = ip.split(".")
    return f"{parts[0]}.{parts[1]}.x.x/16" if len(parts) == 4 else "?"


def short_agent(ua, width=52):
    ua = (ua or "-").strip() or "-"
    ua = ua.replace("|", "/")
    return ua if len(ua) <= width else ua[: width - 1] + "…"


# --------------------------------------------------------------------------------------
# Reports
# --------------------------------------------------------------------------------------

def report_inspect(rows, failures, trailing_shapes, files_read, out):
    w = out.write
    w("# Listener log inspection\n\n")
    w("Answers one question: **what can this instrument actually see?**\n\n")

    total_fail = sum(failures.values())
    w(f"- Files read: **{len(files_read)}**\n")
    w(f"- Lines parsed: **{len(rows):,}**\n")
    w(f"- Lines rejected: **{total_fail:,}**"
      + (f" ({', '.join(f'{k} {v:,}' for k, v in failures.items())})" if total_fail else "")
      + "\n")
    if rows:
        lo = min(r.ts for r in rows)
        hi = max(r.ts for r in rows)
        w(f"- Date range: **{lo:%Y-%m-%d %H:%M %Z} → {hi:%Y-%m-%d %H:%M %Z}** "
          f"({(hi - lo).days} days)\n")
    w("\n")

    for path, n in files_read:
        w(f"  - `{os.path.basename(path)}` — {n:,} rows\n")
    if not rows:
        w("No rows parsed. Nothing further can be said.\n")
        return

    w("\n## Traffic composition\n\n")
    w("Icecast logs every request. Most of them are not listeners.\n\n")
    kinds = Counter(r.kind for r in rows)
    w("| class | lines | share |\n|---|---|---|\n")
    for k in ("audio", "infra", "other"):
        n = kinds.get(k, 0)
        w(f"| {k} | {n:,} | {n / len(rows):.1%} |\n")
    w("\n")

    infra = [r for r in rows if r.kind == "infra"]
    if infra and len(rows) > 0:
        top_infra = Counter(r.mount for r in infra).most_common(4)
        w("Top infrastructure paths: "
          + ", ".join(f"`{m}` ×{n:,}" for m, n in top_infra) + "\n\n")
        poll = next((n for m, n in top_infra if "listclients" in m or "stats" in m), 0)
        if poll and rows:
            span = (max(r.ts for r in rows) - min(r.ts for r in rows)).total_seconds()
            if span > 0:
                w(f"> `/admin/*` polling runs roughly every **{span / poll:.1f}s**. That is\n"
                  f"> AzuraCast's own listener sampler, and it is the reason the API cannot\n"
                  f"> answer the bail-rate question: sessions shorter than that interval\n"
                  f"> may never appear in its listener table at all.\n\n")

    sess = sessions_of(rows)
    audio = [r for r in rows if r.kind == "audio"]
    w("## Sessions\n\n")
    w(f"- Audio-mount requests: **{len(audio):,}**\n")
    w(f"- Of those, successful with a duration (**real sessions**): **{len(sess):,}**\n")
    failed = [r for r in audio if r.status not in SESSION_STATUS]
    w(f"- Failed audio requests: **{len(failed):,}**\n\n")
    if failed:
        w("| mount | status | count |\n|---|---|---|\n")
        for (m, s), n in Counter((r.mount, r.status) for r in failed).most_common(8):
            w(f"| `{m}` | {s} | {n:,} |\n")
        w("\n")

    w("## Duration field\n\n")

    with_dur = [r for r in audio if r.duration is not None]
    share = len(with_dur) / len(audio) if audio else 0.0
    w(f"- Rows carrying a trailing integer (candidate duration): "
      f"**{len(with_dur):,} / {len(rows):,}** ({share:.1%})\n")
    w(f"- Trailing-field counts seen: "
      f"{', '.join(f'{k} fields ×{v:,}' for k, v in sorted(trailing_shapes.items()))}\n\n")

    if share < 0.5:
        w("> **This log does not appear to carry per-connection durations.**\n>\n"
          "> Without them, bail rate is not computable from this file — you would have a\n"
          "> count of connections and no way to know how long any of them lasted. Check\n"
          "> whether Icecast's `<accesslog>` is configured with the duration extension,\n"
          "> or whether a proxy is rewriting the log format.\n\n")
        return

    durations = [r.duration for r in sess]
    q = quantisation_check(durations)
    w("### Resolution check — event-driven or sampled?\n\n")
    if not q:
        w("Too few non-zero durations to test.\n\n")
    else:
        w(f"- Minimum non-zero duration observed: **{q['min_nonzero']}s**\n")
        if q["divisors"]:
            w("- **Quantisation detected.** Durations cluster on multiples of:\n")
            for n, sh in q["divisors"]:
                w(f"  - {n}s — {sh:.1%} of values divide evenly\n")
            w("\n> This is the signature of a **sampled** source, not an event-driven\n"
              "> one. Any statistic below the sampling interval is an artifact. Treat\n"
              "> the smallest listed interval as this instrument's resolution floor.\n\n")
        else:
            w("- No quantisation detected — durations take arbitrary values.\n\n")
            w("> Consistent with an **event-driven** log. Sub-minute statistics from\n"
              "> this file can be trusted down to 1-second granularity, which is what\n"
              "> the bail-rate question needs.\n\n")

    sd = sorted(durations)
    w("### Duration spread\n\n| percentile | duration |\n|---|---|\n")
    for label, qq in (("min", 0.0), ("p05", .05), ("p25", .25), ("median", .5),
                      ("p75", .75), ("p95", .95), ("p99", .99), ("max", 1.0)):
        w(f"| {label} | {fmt_dur(percentile(sd, qq))} |\n")
    w("\nRun `--report` for the full analysis.\n")


def report_full(rows, failures, files_read, tz_offset, salt, out, excluded_ips=()):
    w = out.write
    with_dur = sessions_of(rows)
    tz = timezone(timedelta(hours=tz_offset))

    w("# Listener session digest\n\n")
    if not rows:
        w("No rows parsed.\n")
        return
    lo, hi = min(r.ts for r in rows), max(r.ts for r in rows)
    days = max(1, (hi - lo).total_seconds() / 86400)
    audio = [r for r in rows if r.kind == "audio"]
    failed = [r for r in audio if r.status not in SESSION_STATUS]
    w(f"- Window: **{lo:%Y-%m-%d} → {hi:%Y-%m-%d}** ({days:.0f} days)\n")
    w(f"- Log lines: **{len(rows):,}** "
      f"({len(rows) - len(audio):,} infrastructure, excluded)\n")
    w(f"- **Sessions: {len(with_dur):,}** ({len(with_dur) / days:.0f}/day)\n")
    w(f"- Failed audio requests: **{len(failed):,}** — see *Rejected connections*\n")
    w(f"- Local hours reported at UTC{tz_offset:+d}\n\n")

    if len(with_dur) < 100:
        w("> Too few durations to analyse. Run `--inspect` — the log may not carry\n"
          "> the duration field.\n")
        return

    # -------------------------------------------------------- automation separation
    human, auto, diag = split_traffic(with_dur)
    w("## Automation separation\n\n")
    w(f"| | sessions | share | distinct IPs |\n|---|---|---|---|\n")
    for label, group in (("Automated", auto), ("**Human (residual)**", human)):
        ips = len({r.ip for r in group})
        w(f"| {label} | {len(group):,} | {len(group) / len(with_dur):.1%} | {ips:,} |\n")
    w("\n> **The human set is a residual, not a clean population.** Everything not\n"
      "> positively identified as automated lands in it, so its bail rate is an *upper*\n"
      "> bound and its survivor share a *lower* bound. The true audience is at least\n"
      "> this good and probably better.\n\n")

    w("| user agent | sessions | IPs | req/IP | verdict |\n|---|---|---|---|---|\n")
    for ua, n, ips, conc, is_bot, reason in diag[:15]:
        w(f"| `{short_agent(ua, 44)}` | {n:,} | {ips:,} | {conc:.0f} | "
          f"{'auto — ' + reason if is_bot else 'human'} |\n")
    w("\n")

    # -------------------------------------------------------- hour concentration
    w("### Listening-hour concentration\n\n")
    w("Which addresses own the listening time. A relay or an insider at the top of this\n"
      "table invalidates every aggregate above it, and neither is caught by\n"
      "volume-based detection — a relay makes very few, very long connections.\n\n")
    tot, cnt = defaultdict(float), Counter()
    for r in human:
        tot[r.ip] += r.duration
        cnt[r.ip] += 1
    grand = sum(tot.values()) or 1.0
    w(f"Human listening: **{grand / 3600:.0f}h** across **{len(tot):,}** addresses.\n\n")
    w("| address | sessions | hours | share |\n|---|---|---|---|\n")
    for ip, secs in sorted(tot.items(), key=lambda kv: -kv[1])[:8]:
        w(f"| `{mask_ip(ip)}` | {cnt[ip]:,} | {secs / 3600:.1f} | "
          f"{secs / grand:.1%} |\n")
    w("\n")
    if excluded_ips:
        w(f"Excluded via `--exclude-ip`: {', '.join('`' + p + '`' for p in excluded_ips)}\n\n")

    if len(human) < 100:
        w("> Too few human sessions for the analysis below; it runs on all sessions.\n\n")
    else:
        with_dur = human
        w("**Everything below is the human residual only.**\n\n")

    durations = [r.duration for r in with_dur]
    sd = sorted(durations)
    hist, _, _ = log_histogram(durations)
    anti = find_antimode(hist)

    # ---------------------------------------------------------------- bail vs stay
    w("## Bail vs stay\n\n")
    if anti and anti[1] >= MIN_DIP_RATIO:
        thr, dip, pa, pb = anti
        w(f"**The distribution is bimodal.** Two modes at ~**{fmt_dur(pa)}** and "
          f"~**{fmt_dur(pb)}**, separated by a trough at **{fmt_dur(thr)}** "
          f"(dip depth {dip:.0%}).\n\n")
        w(f"The trough is the *derived* bail threshold — read off the data rather than\n"
          f"assumed. Assuming 60s would have baked the hypothesis into the answer.\n\n")
        threshold = thr
    elif anti:
        thr, dip, pa, pb = anti
        w(f"**No reliable mode boundary.** The deepest trough (at {fmt_dur(thr)}) has a\n"
          f"dip of only {dip:.0%}, below the {MIN_DIP_RATIO:.0%} floor required to call a\n"
          f"split real. On a corpus this size shallow local minima are noise.\n\n")
        w("**5 minutes is used below as a stated convention, not a derived threshold.**\n"
          "It is long enough to exclude sampling and short enough that anyone past it is\n"
          "listening on purpose. Re-run once the corpus grows; the boundary may resolve.\n\n")
        threshold = 300.0
    else:
        w("**No second mode found.** The distribution is unimodal or too noisy to split.\n"
          "5 minutes is used below as a stated convention, not a derived threshold.\n\n")
        threshold = 300.0

    bailed = [d for d in durations if d < threshold]
    stayed = [d for d in durations if d >= threshold]
    w(f"| | count | share |\n|---|---|---|\n")
    w(f"| **Bailed** (< {fmt_dur(threshold)}) | {len(bailed):,} | "
      f"**{len(bailed) / len(durations):.1%}** |\n")
    w(f"| **Stayed** (≥ {fmt_dur(threshold)}) | {len(stayed):,} | "
      f"**{len(stayed) / len(durations):.1%}** |\n\n")

    w("### Robust dispersion, per mode\n\n")
    w("Reported as median / IQR / MAD rather than mean and standard deviation. A\n"
      "bimodal, heavy-tailed population has **no single valid location-and-spread\n"
      "pair** — any figure spanning both modes describes a duration nobody experiences.\n"
      "So each mode is summarised separately, and the mean is shown only to be\n"
      "dismissed.\n\n")
    w("| mode | n | median | IQR | MAD | mean |\n|---|---|---|---|---|---|\n")
    for label, group in (("Bailed", bailed), ("**Stayed**", stayed)):
        st = robust_stats(group)
        if not st:
            w(f"| {label} | {len(group)} | — | — | — | — |\n")
            continue
        w(f"| {label} | {st['n']:,} | **{fmt_dur(st['median'])}** | "
          f"{fmt_dur(st['q1'])} – {fmt_dur(st['q3'])} | {fmt_dur(st['mad'])} | "
          f"{fmt_dur(st['mean'])} |\n")
    w("\n")
    st = robust_stats(stayed)
    if st and st["median"]:
        w(f"**Survivor TSL: median {fmt_dur(st['median'])}, IQR "
          f"{fmt_dur(st['q1'])} – {fmt_dur(st['q3'])}.**\n"
          f"Its mean ({fmt_dur(st['mean'])}) is "
          f"{st['mean'] / st['median']:.1f}× the median — a ratio near 1 means the tail\n"
          f"is no longer dominating; a large one means contamination remains.\n\n")

        ci_med = bootstrap_ci(stayed, lambda d: percentile(d, .5))
        ci_mean = bootstrap_ci(stayed, lambda d: sum(d) / len(d))
        if ci_med:
            w("### How well determined are these?\n\n")
            w("| statistic | value | SE | 95% CI |\n|---|---|---|---|\n")
            w(f"| survivor median | {fmt_dur(st['median'])} | {fmt_dur(ci_med['se'])} | "
              f"{fmt_dur(ci_med['lo'])} – {fmt_dur(ci_med['hi'])} |\n")
            if ci_mean:
                w(f"| survivor mean | {fmt_dur(st['mean'])} | {fmt_dur(ci_mean['se'])} | "
                  f"{fmt_dur(ci_mean['lo'])} – {fmt_dur(ci_mean['hi'])} |\n")
            share = len(stayed) / (len(stayed) + len(bailed))
            n_all = len(stayed) + len(bailed)
            sh_se = math.sqrt(share * (1 - share) / n_all)
            w(f"| survivor share | {share:.1%} | {sh_se:.1%} | "
              f"{max(0, share - 1.96 * sh_se):.1%} – {share + 1.96 * sh_se:.1%} |\n\n")
            w("> **The share is the well-determined figure; the TSL is not.** Quote the\n"
              "> interval, not the point estimate, and do not build on a difference\n"
              "> smaller than the SE. Precision here is bounded by the number of\n"
              f"> survivors ({len(stayed)}), which only more weeks can fix.\n\n")
            if ci_mean and ci_mean["se"] < ci_med["se"]:
                w("> Note: the **mean is the more precise estimator here** — the median\n"
                  "> sits in a sparse region of this distribution. The median remains the\n"
                  "> right choice against *contamination*; the mean is the more efficient\n"
                  "> one once contamination is removed. Different jobs.\n\n")

    w("### Fixed reference cuts\n\n| under | count | share |\n|---|---|---|\n")
    for t in (5, 10, 30, 60, 300, 1800):
        n = sum(1 for d in durations if d < t)
        w(f"| {fmt_dur(t)} | {n:,} | {n / len(durations):.1%} |\n")
    w("\n")

    w("### Distribution\n\n```\n")
    peak = max((c for _, c in hist), default=1) or 1
    for center, c in hist:
        bar = "█" * int(40 * c / peak)
        w(f"{fmt_dur(10 ** center):>7} | {bar:<40} {c:>7,}\n")
    w("```\n\n")

    # ---------------------------------------------------------------- user agents
    w("## User agents\n\n")
    w("Scrapers are **detected, not assumed**. A short session is not evidence of a bot;\n"
      "a *regular* one is. Low gap-variance (CV) means connections arrive on a timer,\n"
      "which is what a directory health-check looks like and what a human never does.\n\n")
    by_ua = defaultdict(list)
    for r in with_dur:
        by_ua[r.agent].append(r)
    ranked = sorted(by_ua.items(), key=lambda kv: len(kv[1]), reverse=True)[:20]
    w("| user agent | conns | share | median | bail % | gap CV | every |\n")
    w("|---|---|---|---|---|---|---|\n")
    for ua, rs in ranked:
        ds = sorted(r.duration for r in rs)
        bail = sum(1 for d in ds if d < threshold) / len(ds)
        per = periodicity([r.ts for r in rs])
        cv = f"{per[0]:.2f}" if per else "—"
        every = fmt_dur(per[1]) if per and per[0] < 0.35 else "—"
        flag = " ⏱" if per and per[0] < 0.35 else ""
        w(f"| `{short_agent(ua)}`{flag} | {len(rs):,} | {len(rs) / len(with_dur):.1%} | "
          f"{fmt_dur(percentile(ds, .5))} | {bail:.0%} | {cv} | {every} |\n")
    w("\n⏱ = near-constant arrival interval; treat as automated until proven otherwise.\n\n")

    # ---------------------------------------------------------------- by hour
    w("## By local hour\n\n")
    w("Feeds the daypart matrix, which currently runs on *assumed* propensity curves\n"
      "(FORMAT-WORKFLOW Phase 5, step 30). These are measurements.\n\n")
    by_hour = defaultdict(list)
    for r in with_dur:
        by_hour[r.ts.astimezone(tz).hour].append(r.duration)
    w("| hour | conns | bail % | median | survivor median |\n|---|---|---|---|---|\n")
    for h in range(24):
        ds = by_hour.get(h, [])
        if not ds:
            w(f"| {h:02d} | 0 | — | — | — |\n")
            continue
        srv = sorted(d for d in ds if d >= threshold)
        bail = sum(1 for d in ds if d < threshold) / len(ds)
        w(f"| {h:02d} | {len(ds):,} | {bail:.0%} | "
          f"{fmt_dur(percentile(sorted(ds), .5))} | "
          f"{fmt_dur(percentile(srv, .5)) if srv else '—'} |\n")
    w("\n")

    # ---------------------------------------------------------------- day of week
    w("## By day of week\n\n")
    dow_names = "Mon Tue Wed Thu Fri Sat Sun".split()
    by_dow = defaultdict(list)
    for r in with_dur:
        by_dow[r.ts.astimezone(tz).weekday()].append(r.duration)
    w("| day | conns | bail % | survivor median |\n|---|---|---|---|\n")
    for d in range(7):
        ds = by_dow.get(d, [])
        if not ds:
            w(f"| {dow_names[d]} | 0 | — | — |\n")
            continue
        srv = sorted(x for x in ds if x >= threshold)
        w(f"| {dow_names[d]} | {len(ds):,} | "
          f"{sum(1 for x in ds if x < threshold) / len(ds):.0%} | "
          f"{fmt_dur(percentile(srv, .5)) if srv else '—'} |\n")
    w("\n")

    # ---------------------------------------------------------------- mounts
    w("## By mount\n\n")
    by_mount = defaultdict(list)
    for r in with_dur:
        by_mount[r.mount].append(r.duration)
    w("| mount | conns | bail % | survivor median |\n|---|---|---|---|\n")
    for mount, ds in sorted(by_mount.items(), key=lambda kv: len(kv[1]), reverse=True)[:15]:
        srv = sorted(d for d in ds if d >= threshold)
        w(f"| `{mount}` | {len(ds):,} | "
          f"{sum(1 for d in ds if d < threshold) / len(ds):.0%} | "
          f"{fmt_dur(percentile(srv, .5)) if srv else '—'} |\n")
    w("\n")

    # ---------------------------------------------------------------- repeat clients
    w("## Repeat clients\n\n")
    by_client = defaultdict(list)
    for r in with_dur:
        key = hashlib.sha256((salt + r.ip).encode()).hexdigest()[:16]
        by_client[key].append(r)
    counts = Counter(len(v) for v in by_client.values())
    total_clients = len(by_client)
    once = counts.get(1, 0)
    w(f"- Distinct client fingerprints: **{total_clients:,}**\n")
    w(f"- Connected exactly once: **{once:,}** ({once / total_clients:.1%})\n")
    w(f"- Connected 5+ times: "
      f"**{sum(v for k, v in counts.items() if k >= 5):,}**\n\n")
    w("> Addresses are salted and hashed; the salt is per-run, so fingerprints are not\n"
      "> comparable across runs and cannot be reversed. Treat these as a **floor** on\n"
      "> distinct listeners and a **ceiling** on repeat rate: CGNAT and mobile carriers\n"
      "> collapse many people onto one address, and dynamic IPs split one person across\n"
      "> several.\n\n")

    # ---------------------------------------------------------------- rejected
    w("## Rejected connections\n\n")
    w("Requests to an audio mount that never received audio. **These are acquisition\n"
      "losses, not listeners** — somebody tried to tune in and got nothing. A directory\n"
      "listing pointed at a mount that does not exist will show up here and nowhere\n"
      "else, because a 404 never becomes a session.\n\n")
    if not failed:
        w("None.\n\n")
    else:
        by_mount_status = Counter((r.mount, r.status) for r in failed)
        w("| mount | status | count | share of failures |\n|---|---|---|---|\n")
        for (m, s), n in by_mount_status.most_common(10):
            w(f"| `{m}` | {s} | {n:,} | {n / len(failed):.0%} |\n")
        w("\n**By client** — a human user agent here is a lost listener, not a bot:\n\n")
        w("| user agent | count |\n|---|---|\n")
        for ua, n in Counter(r.agent for r in failed).most_common(10):
            w(f"| `{short_agent(ua)}` | {n:,} |\n")
        w("\n")

    # ---------------------------------------------------------------- caveats
    w("## What this digest cannot tell you\n\n")
    w("1. **Why anyone left.** Tune-out is correlational. Someone leaving during a song\n"
      "   did not necessarily leave because of it — commutes end regardless of what is\n"
      "   playing. Attribution needs the join against `play_history`, daypart\n"
      "   normalisation, and a minimum-plays floor before it drives any drop decision.\n")
    w("2. **Geography.** Not in the access log. Needs IP→geo enrichment, which is the\n"
      "   one thing the AzuraCast API adds that this file does not.\n")
    w("3. **Which song was playing.** Same — requires the reconciliation step.\n")
    w("4. **Whether a bail was a rejection.** A listener who samples the stream for two\n"
      "   seconds from a directory listing behaves identically to a failed connection.\n")


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("paths", nargs="+", help="log file(s), .gz, or directory")
    ap.add_argument("--inspect", action="store_true",
                    help="format detection and resolution check only")
    ap.add_argument("--report", action="store_true", help="full digest")
    ap.add_argument("--tz", type=int, default=0,
                    help="station-local UTC offset in hours (default 0)")
    ap.add_argument("--since", help="YYYY-MM-DD lower bound")
    ap.add_argument("--until", help="YYYY-MM-DD upper bound")
    ap.add_argument("--out", help="write digest here instead of stdout")
    ap.add_argument("--exclude-ip", action="append", metavar="PREFIX",
                    help="drop sessions from addresses starting with PREFIX. Use for "
                         "known insiders (the PD's own listening) and relays. Repeatable.")
    args = ap.parse_args()

    if not (args.inspect or args.report):
        args.inspect = True

    def bound(s, end=False):
        if not s:
            return None
        d = datetime.strptime(s, "%Y-%m-%d").replace(tzinfo=timezone.utc)
        return d + timedelta(days=1) if end else d

    rows, failures, shapes, files_read = read_rows(
        args.paths, bound(args.since), bound(args.until, True))

    if args.exclude_ip:
        before = len(rows)
        rows = [r for r in rows
                if not any(r.ip.startswith(p) for p in args.exclude_ip)]
        print(f"excluded {before - len(rows):,} rows by address prefix", file=sys.stderr)

    out = open(args.out, "w") if args.out else sys.stdout
    try:
        if args.inspect:
            report_inspect(rows, failures, shapes, files_read, out)
        else:
            report_full(rows, failures, files_read, args.tz,
                        secrets.token_hex(16), out, args.exclude_ip or [])
    finally:
        if args.out:
            out.close()
            print(f"wrote {args.out}", file=sys.stderr)


if __name__ == "__main__":
    main()
