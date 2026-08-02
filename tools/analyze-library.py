#!/usr/bin/env python3
"""
Offline audio analysis for the RadioDJ library. Runs on the Windows broadcast box,
where the audio lives.

Reads only. Writes a JSONL feature file; it never touches RadioDJ's database and never
modifies the audio. Ingest into the Scheduler is a separate step.

Pass 1 (this script) extracts raw per-track features. Pass 2 (--score) ranks them
across the whole corpus and assigns the 1-5 bands the engine actually consumes —
banding cannot be done per-track because it is relative to the library.

WHY 1-5 AND NOT BPM: packages/engine/src/scoring.ts computes
    flowScore = 1 - (|dTempo| + |dEnergy|) / 8
and the tempo_clash rule uses maxJump: 2. That only makes sense if both fields are
1-5 bands — the maximum difference of 4 on each of two fields sums to 8. Raw BPM in
the tempo column would break both.

Usage
-----
  # 1. export id/path pairs from RadioDJ (read-only), or point at a folder
  python analyze-library.py --input songs.csv --out features.jsonl
  python analyze-library.py --scan "D:\\Music" --out features.jsonl

  # 2. band the results across the corpus
  python analyze-library.py --score features.jsonl --out coded.jsonl

Resumable: re-running skips tracks already present in --out.

Requires: python -m pip install librosa soundfile numpy
ffmpeg on PATH is strongly recommended — librosa decodes MP3 far faster with it.
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import sys
import time
from pathlib import Path

AUDIO_EXT = {".mp3", ".flac", ".wav", ".m4a", ".aac", ".ogg", ".wma"}

# Per-station configuration. Tracks live on one filesystem but are separated by
# station-level folders, so a path prefix decides which station a file belongs to.
#
# Bands and energy percentiles are BOTH per-station, and for the same reason: they are
# relative measures. A CHR station carrying ballads and EDM has a far wider tempo spread
# than an alt-rock station, so identical boundaries would put most of one library in a
# single band — which carries no information. Energy is a percentile rank within a
# corpus, so pooling two libraries distorts both.
#
# Override with --stations stations.json using the same shape.
DEFAULT_STATIONS = {
    "BOLT": {
        "prefixes": ["bolt"],
        # alt / active rock: narrow spread, most material 100-150
        "tempo_bands": [[0, 92, 1], [92, 112, 2], [112, 132, 3], [132, 156, 4], [156, 999, 5]],
    },
    "TOP": {
        "prefixes": ["top"],
        # CHR / Top 40: ballads at one end, EDM at the other, so the bands stretch
        "tempo_bands": [[0, 82, 1], [82, 100, 2], [100, 118, 3], [118, 140, 4], [140, 999, 5]],
    },
}


def station_for(path: str, stations: dict) -> str | None:
    low = path.replace("\\", "/").lower()
    best, best_len = None, -1
    for name, cfg in stations.items():
        for pre in cfg["prefixes"]:
            p = pre.replace("\\", "/").lower()
            if p in low and len(p) > best_len:
                best, best_len = name, len(p)
    return best


def band_for(bpm: float, bands) -> int:
    for lo, hi, b in bands:
        if lo <= bpm < hi:
            return b
    return 3


def analyse(path: str) -> dict | None:
    """Raw features for one file. Returns None if the file cannot be read."""
    import numpy as np
    import librosa

    try:
        # 22kHz mono is plenty for tempo/energy and roughly 4x faster than native rate.
        y, sr = librosa.load(path, sr=22050, mono=True, duration=300)
    except Exception as e:  # unreadable / corrupt / unsupported codec
        return {"path": path, "error": f"{type(e).__name__}: {e}"}

    if y.size == 0:
        return {"path": path, "error": "empty audio"}

    # Trim leading/trailing silence so intros don't drag the energy measures down.
    y_t, _ = librosa.effects.trim(y, top_db=40)
    if y_t.size > sr:
        y = y_t

    # Half/double-time confusion is the dominant tempo failure mode: a beat tracker
    # cannot always tell which pulse level is "the beat", so a driving 150 BPM track
    # often reports 75. Estimating twice from different priors exposes it — if the two
    # answers differ by roughly a factor of two, the track is genuinely ambiguous and
    # goes on the spot-check list rather than being silently guessed at.
    onset_env = librosa.onset.onset_strength(y=y, sr=sr)
    t_slow = float(librosa.feature.tempo(onset_envelope=onset_env, sr=sr, start_bpm=60)[0])
    t_fast = float(librosa.feature.tempo(onset_envelope=onset_env, sr=sr, start_bpm=140)[0])
    tempo = float(librosa.beat.beat_track(y=y, sr=sr, onset_envelope=onset_env)[0])

    ratio = max(t_slow, t_fast) / max(min(t_slow, t_fast), 1e-6)
    ambiguous = abs(ratio - 2.0) < 0.25 or abs(ratio - 0.5) < 0.125

    # Fold into a range plausible for popular music, but record that we did.
    folded = False
    while 0 < tempo < 70:
        tempo *= 2
        folded = True
    while tempo > 190:
        tempo /= 2
        folded = True

    rms = librosa.feature.rms(y=y)[0]
    centroid = librosa.feature.spectral_centroid(y=y, sr=sr)[0]
    onsets = librosa.onset.onset_detect(onset_envelope=onset_env, sr=sr)
    duration = float(librosa.get_duration(y=y, sr=sr))

    return {
        "path": path,
        "duration_s": round(duration, 1),
        "bpm": round(tempo, 1),
        "bpm_slow_prior": round(t_slow, 1),
        "bpm_fast_prior": round(t_fast, 1),
        "tempo_ambiguous": bool(ambiguous),
        "tempo_folded": bool(folded),
        # loudness proxy; not EBU R128, but consistent across the corpus which is all
        # the banding needs
        "rms_db": round(float(20 * np.log10(np.mean(rms) + 1e-9)), 2),
        "rms_peak_db": round(float(20 * np.log10(np.percentile(rms, 95) + 1e-9)), 2),
        "centroid_hz": round(float(np.mean(centroid)), 1),
        "onset_rate": round(len(onsets) / duration, 3) if duration else 0.0,
        "onset_strength": round(float(np.mean(onset_env)), 3),
    }


def load_done(out_path: Path) -> set[str]:
    done: set[str] = set()
    if out_path.exists():
        with out_path.open("r", encoding="utf-8") as f:
            for line in f:
                try:
                    done.add(json.loads(line)["path"])
                except Exception:
                    pass
    return done


def cmd_analyse(args) -> int:
    targets: list[tuple[str | None, str]] = []
    if args.input:
        with open(args.input, newline="", encoding="utf-8-sig") as f:
            for row in csv.DictReader(f):
                p = row.get("path") or row.get("Path") or row.get("filename")
                if p:
                    targets.append((row.get("rdj_song_id") or row.get("ID"), p))
    elif args.scan:
        for root, _, files in os.walk(args.scan):
            for fn in files:
                if Path(fn).suffix.lower() in AUDIO_EXT:
                    targets.append((None, str(Path(root) / fn)))
    else:
        print("need --input or --scan", file=sys.stderr)
        return 2

    out_path = Path(args.out)
    done = load_done(out_path)
    todo = [(i, p) for i, p in targets if p not in done]
    print(f"{len(targets)} tracks, {len(done)} already done, {len(todo)} to analyse")

    started, errors = time.time(), 0
    with out_path.open("a", encoding="utf-8") as out:
        for n, (song_id, path) in enumerate(todo, 1):
            if not os.path.exists(path):
                rec = {"path": path, "error": "file not found"}
            else:
                rec = analyse(path)
            if song_id:
                rec["rdj_song_id"] = int(song_id)
            if rec.get("error"):
                errors += 1
            out.write(json.dumps(rec, ensure_ascii=False) + "\n")
            out.flush()
            if n % 10 == 0 or n == len(todo):
                rate = n / max(time.time() - started, 1e-9)
                eta = (len(todo) - n) / rate / 60 if rate else 0
                print(f"  {n}/{len(todo)}  {rate*60:.1f}/min  eta {eta:.0f}m  errors {errors}")
    print(f"done. {errors} error(s). -> {out_path}")
    return 0


def cmd_score(args) -> int:
    """
    Pass 2: band PER STATION. Both measures are relative, so they must be computed
    within each station's own corpus — pooling a CHR library carrying ballads and EDM
    with an alt-rock one distorts both distributions. The same track appearing in both
    libraries can legitimately land on different bands.
    """
    import numpy as np

    stations = DEFAULT_STATIONS
    if args.stations:
        with open(args.stations, encoding="utf-8") as f:
            stations = json.load(f)

    recs, bad = [], 0
    with open(args.score, encoding="utf-8") as f:
        for line in f:
            r = json.loads(line)
            if r.get("error"):
                bad += 1
                continue
            recs.append(r)

    by_station: dict[str, list] = {}
    unassigned = []
    for r in recs:
        st = station_for(r["path"], stations)
        if st is None:
            unassigned.append(r)
        else:
            by_station.setdefault(st, []).append(r)

    out_path = Path(args.out)
    spot_path = out_path.with_name(out_path.stem + "-spotcheck.csv")
    spot_rows = []

    with out_path.open("w", encoding="utf-8") as out:
        for st, group in sorted(by_station.items()):
            bands = stations[st]["tempo_bands"]

            def pct(vals):
                order = np.argsort(np.argsort(np.array(vals, dtype=float)))
                return order / max(len(vals) - 1, 1)

            loud = pct([r["rms_db"] for r in group])
            bright = pct([r["centroid_hz"] for r in group])
            dens = pct([r["onset_strength"] for r in group])

            hist = {b: 0 for b in range(1, 6)}
            for i, r in enumerate(group):
                e = (loud[i] + bright[i] + dens[i]) / 3
                energy = int(min(5, max(1, round(e * 4 + 1))))
                tb = band_for(r["bpm"], bands)
                hist[tb] += 1
                rec = {
                    "path": r["path"], "station": st,
                    "tempo": tb, "energy": energy,
                    "bpm_raw": r["bpm"], "energy_raw": round(float(e), 3),
                }
                if "rdj_song_id" in r:
                    rec["rdj_song_id"] = r["rdj_song_id"]
                out.write(json.dumps(rec, ensure_ascii=False) + "\n")

                # ---- spot-check triage ----
                # Only estimates that are actually uncertain are worth a human ear.
                reasons = []
                if r.get("tempo_ambiguous"):
                    reasons.append("half/double ambiguity")
                if r.get("tempo_folded"):
                    reasons.append("folded into range")
                edge = min(abs(r["bpm"] - b[0]) for b in bands if b[0] > 0)
                if edge < 4:
                    reasons.append(f"{edge:.1f} BPM from a band edge")
                if reasons:
                    spot_rows.append({
                        "station": st, "path": r["path"], "bpm": r["bpm"],
                        "slow_prior": r.get("bpm_slow_prior"), "fast_prior": r.get("bpm_fast_prior"),
                        "tempo_band": tb, "reason": "; ".join(reasons),
                    })

            total = len(group)
            dist = "  ".join(f"{b}:{hist[b]} ({hist[b]*100//max(total,1)}%)" for b in range(1, 6))
            print(f"{st}: {total} tracks   tempo bands  {dist}")
            worst = max(hist.values()) / max(total, 1)
            if worst > 0.45:
                print(f"   ^ one band holds {worst*100:.0f}% of {st} — it carries little")
                print(f"     information. Retune tempo_bands for {st} and re-run --score.")

    if unassigned:
        print(f"\n{len(unassigned)} track(s) matched no station prefix and were skipped.")
        for r in unassigned[:5]:
            print(f"   {r['path']}")
        if len(unassigned) > 5:
            print(f"   ... and {len(unassigned)-5} more")

    if spot_rows:
        spot_rows.sort(key=lambda r: (r["station"], r["reason"]))
        with spot_path.open("w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=list(spot_rows[0].keys()))
            w.writeheader()
            w.writerows(spot_rows)
        pctg = len(spot_rows) * 100 // max(len(recs), 1)
        print(f"\nspot-check list: {len(spot_rows)} of {len(recs)} tracks ({pctg}%) -> {spot_path}")
        print("These are the estimates the analysis is NOT confident about. Checking the")
        print("rest by ear buys very little — the confident ones are confident for a reason.")
    else:
        print("\nno tracks flagged for spot-check")

    if bad:
        print(f"{bad} track(s) failed analysis and were excluded")
    print(f"\n-> {out_path}")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--input", help="CSV with columns rdj_song_id,path")
    ap.add_argument("--scan", help="folder to walk instead of a CSV")
    ap.add_argument("--score", help="band an existing features file, per station")
    ap.add_argument("--stations", help="station config JSON; defaults to DEFAULT_STATIONS")
    ap.add_argument("--out", required=True)
    args = ap.parse_args()
    return cmd_score(args) if args.score else cmd_analyse(args)


if __name__ == "__main__":
    raise SystemExit(main())
