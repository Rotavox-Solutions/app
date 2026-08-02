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

# Tempo band boundaries in BPM. PROGRAMMING DECISION, not a measurement — these are a
# starting point for alt/active rock and should be reviewed by the PD. Half-time
# detection errors are corrected below before banding.
TEMPO_BANDS = [(0, 92, 1), (92, 112, 2), (112, 132, 3), (132, 156, 4), (156, 999, 5)]


def band_for(bpm: float) -> int:
    for lo, hi, b in TEMPO_BANDS:
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

    tempo = float(librosa.beat.beat_track(y=y, sr=sr)[0])
    # Half/double-time errors are the dominant tempo failure mode. Fold into a band
    # plausible for rock rather than trusting the raw estimate.
    while tempo > 0 and tempo < 70:
        tempo *= 2
    while tempo > 190:
        tempo /= 2

    rms = librosa.feature.rms(y=y)[0]
    centroid = librosa.feature.spectral_centroid(y=y, sr=sr)[0]
    onset_env = librosa.onset.onset_strength(y=y, sr=sr)
    onsets = librosa.onset.onset_detect(onset_envelope=onset_env, sr=sr)
    duration = float(librosa.get_duration(y=y, sr=sr))

    return {
        "path": path,
        "duration_s": round(duration, 1),
        "bpm": round(tempo, 1),
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
    """Pass 2: band across the corpus. Percentile rank, because energy is relative."""
    import numpy as np

    recs = []
    with open(args.score, encoding="utf-8") as f:
        for line in f:
            r = json.loads(line)
            if not r.get("error"):
                recs.append(r)
    if not recs:
        print("no analysable records", file=sys.stderr)
        return 1

    def pct(vals):
        order = np.argsort(np.argsort(np.array(vals, dtype=float)))
        return order / max(len(vals) - 1, 1)

    loud = pct([r["rms_db"] for r in recs])
    bright = pct([r["centroid_hz"] for r in recs])
    dens = pct([r["onset_strength"] for r in recs])

    out_path = Path(args.out)
    with out_path.open("w", encoding="utf-8") as out:
        for i, r in enumerate(recs):
            # Energy is loudness, brightness and attack density in equal measure. All
            # three are percentile ranks, so the result is relative to THIS library —
            # which is what the engine's flow comparison actually wants.
            e = (loud[i] + bright[i] + dens[i]) / 3
            energy = int(min(5, max(1, round(e * 4 + 1))))
            rec = {
                "path": r["path"],
                "tempo": band_for(r["bpm"]),
                "energy": energy,
                "bpm_raw": r["bpm"],
                "energy_raw": round(float(e), 3),
            }
            if "rdj_song_id" in r:
                rec["rdj_song_id"] = r["rdj_song_id"]
            out.write(json.dumps(rec, ensure_ascii=False) + "\n")

    hist = {}
    for i, r in enumerate(recs):
        hist[band_for(r["bpm"])] = hist.get(band_for(r["bpm"]), 0) + 1
    print(f"scored {len(recs)} tracks -> {out_path}")
    print("tempo band distribution: " + "  ".join(f"{b}:{hist.get(b,0)}" for b in range(1, 6)))
    print("\nReview the distribution before ingesting. A band holding most of the")
    print("library carries no information — retune TEMPO_BANDS and re-run --score.")
    print("(--score is cheap; it does not re-analyse audio.)")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--input", help="CSV with columns rdj_song_id,path")
    ap.add_argument("--scan", help="folder to walk instead of a CSV")
    ap.add_argument("--score", help="band an existing features file across the corpus")
    ap.add_argument("--out", required=True)
    args = ap.parse_args()
    return cmd_score(args) if args.score else cmd_analyse(args)


if __name__ == "__main__":
    raise SystemExit(main())
