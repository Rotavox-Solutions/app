import type { EngineSong, HistoryEntry } from "./types.js";

export type SepKind = "artist" | "title" | "album" | "song";

export function normKey(value: string): string {
  return value.trim().toLowerCase();
}

// Tracks the latest occurrence of each artist / title / album / song id across BOTH
// aired history and the not-yet-aired items already placed in the log being built.
// All queries are answered relative to a caller-supplied instant (the candidate
// slot's projected_air_at) — never a wall clock, which doesn't exist in this package.
export class SeparationState {
  private artist = new Map<string, number>();
  private title = new Map<string, number>();
  private album = new Map<string, number>();
  private song = new Map<number, number>();
  // Horizontal separation needs more than "when did this last play" — it needs the
  // hour-of-day of several recent plays. Bounded so a long regen can't grow unbounded.
  private songPlays = new Map<number, number[]>();

  constructor(history: HistoryEntry[]) {
    for (const h of history) {
      if (h.artist) this.bump(this.artist, normKey(h.artist), h.airedAt.getTime());
      if (h.title) this.bump(this.title, normKey(h.title), h.airedAt.getTime());
      if (h.rdjSongId != null) {
        this.bump(this.song, h.rdjSongId, h.airedAt.getTime());
        this.pushPlay(h.rdjSongId, h.airedAt.getTime());
      }
    }
  }

  private bump<K>(map: Map<K, number>, key: K, t: number): void {
    const prev = map.get(key);
    if (prev === undefined || t > prev) map.set(key, t);
  }

  private static readonly MAX_PLAYS = 64;

  private pushPlay(songId: number, t: number): void {
    const list = this.songPlays.get(songId);
    if (!list) { this.songPlays.set(songId, [t]); return; }
    list.push(t);
    if (list.length > SeparationState.MAX_PLAYS) list.splice(0, list.length - SeparationState.MAX_PLAYS);
  }

  /**
   * Timestamps of this song's plays strictly within `withinMs` before `at`.
   * Plays at or after `at` are excluded — during a regen over already-aired history
   * the future is not evidence about the slot being filled.
   */
  playsWithin(songId: number, at: Date, withinMs: number): number[] {
    const list = this.songPlays.get(songId);
    if (!list) return [];
    const now = at.getTime(), floor = now - withinMs;
    return list.filter((t) => t > floor && t < now);
  }

  private mapFor(kind: SepKind): Map<string | number, number> {
    switch (kind) {
      case "artist":
        return this.artist as Map<string | number, number>;
      case "title":
        return this.title as Map<string | number, number>;
      case "album":
        return this.album as Map<string | number, number>;
      case "song":
        return this.song as Map<string | number, number>;
    }
  }

  /**
   * Minutes between the latest occurrence and `at`. Infinity if never seen.
   * NEGATIVE when the latest occurrence is after `at` (only possible when
   * regenerating over already-aired history) — callers' `gap >= minMinutes` checks
   * then fail closed, which is the safe answer.
   */
  gapMinutes(kind: SepKind, key: string | number, at: Date): number {
    const last = this.mapFor(kind).get(kind === "song" ? key : normKey(String(key)));
    if (last === undefined) return Infinity;
    return (at.getTime() - last) / 60_000;
  }

  /** Records a placement at its projected air time. */
  record(song: EngineSong, at: Date): void {
    const t = at.getTime();
    if (song.artist) this.bump(this.artist, normKey(song.artist), t);
    if (song.title) this.bump(this.title, normKey(song.title), t);
    if (song.album) this.bump(this.album, normKey(song.album), t);
    this.bump(this.song, song.rdjSongId, t);
    this.pushPlay(song.rdjSongId, t);
  }
}
