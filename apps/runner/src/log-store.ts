// The Runner's own copy of the station's logs (ADR-0004 §6). Pacing decides from this
// copy and never waits on Rotavox, so an outage of the web app, the database or the
// network between them can't take the station off air while the copy reaches ahead.
//
// - The copy covers approved logs from an hour ago to COPY_AHEAD_HOURS ahead. It is
//   refreshed every REFRESH_MS; a log whose content hasn't changed costs one row.
// - pushed_at and aired_at are the Runner's: it is their only writer. A change is made
//   here first, saved to disk, then reported to Rotavox in the background. Reports that
//   can't be sent wait in the file, in order, and go when Rotavox is back.
// - Rotavox owns everything else. A refresh takes each item's content (a PD's swap or
//   replace) and which logs are approved from Rotavox, and keeps the Runner's times.
//
// Edits can't reach an item within SAFETY_HORIZON_MINUTES (15) of air, and the refresh
// runs every 30s, so an item is always current in the copy well before it's pushed.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { decodeWire, encodeWire, type HistoryRow, type LogRow, type PacingItem, type WindowLog } from "@rotavox/schema";
import { replaceFile } from "./files.js";
import type { SchedulerClient } from "./scheduler.js";

export type { LogRow, PacingItem };

export const LOG_STORE_PATH = process.env.RUNNER_STATE_PATH ?? path.join(process.cwd(), "runner-state.json");

/** How far ahead the copy reaches. An outage shorter than this never touches the air. */
export const COPY_AHEAD_HOURS = 26;
const COPY_BEHIND_HOURS = 1;
export const REFRESH_MS = 30_000;
const FLUSH_MS = 5_000;
/** Item reports per call, so a long outage's backlog goes in bounded requests. */
const REPORT_CHUNK = 200;

type Say = (...args: unknown[]) => void;
type Times = { pushedAt: Date | null; airedAt: Date | null };
export interface CachedLog {
  log: LogRow;
  digest: string;
  items: PacingItem[];
}
export interface HistoryBatch {
  rows: HistoryRow[];
  watermark: number;
}

interface StoreFile {
  version: 1;
  stationId: string | null;
  logs: CachedLog[];
  pendingTimes: Record<string, Times>;
  pendingHistory: HistoryBatch[];
  historyWatermark: number | null;
  refreshedAt: Date | null;
}

// ── Pacing queries over a copy ──────────────────────────────────────────────────────
// Each is the query the Runner used to ask Rotavox, kept to the same meaning.

/** The current log: approved, and `at` falls inside [starts_at, ends_at); the most recently generated wins. */
export function pickCurrentLog(logs: CachedLog[], at: Date): CachedLog | null {
  const t = at.getTime();
  const covering = logs.filter(
    (l) => l.log.status === "approved" && l.log.startsAt.getTime() <= t && t < l.log.endsAt.getTime(),
  );
  // Postgres sorted NULL generated_at last, which made it the winner; kept.
  const gen = (l: CachedLog) => l.log.generatedAt?.getTime() ?? Infinity;
  return covering.sort((a, b) => gen(a) - gen(b)).at(-1) ?? null;
}

/** fixed_event items are RadioDJ's (§6); the Runner never pushes them. */
const ours = (i: PacingItem) => i.elementType !== "fixed_event";

export const unpushedItems = (items: PacingItem[]) => items.filter((i) => ours(i) && i.pushedAt == null);

/**
 * What the queue-drain projection needs: the audio pushed and not yet started, and when
 * the item on air ends. The item on air is the most recently stamped one; the queue
 * cannot drain before it finishes.
 */
export function queueDrainInputs(items: PacingItem[]): { pendingMs: number; playingEndsAtMs: number | null } {
  let pendingMs = 0;
  let playing: PacingItem | null = null;
  for (const i of items) {
    if (i.pushedAt != null && i.airedAt == null) pendingMs += i.timingMs;
    if (i.airedAt != null && (!playing || i.airedAt.getTime() > playing.airedAt!.getTime())) playing = i;
  }
  return { pendingMs, playingEndsAtMs: playing ? playing.airedAt!.getTime() + playing.timingMs : null };
}

/**
 * The earliest pushed-but-unaired item carrying `rdjSongId`. The now-playing watch and
 * the history backstop both stamp through this; whichever fires first for an item wins.
 * None is expected for a filler repeat, which has no planned counterpart.
 */
export function airingCandidate(items: PacingItem[], rdjSongId: number): PacingItem | null {
  return items.find((i) => i.rdjSongId === rdjSongId && i.pushedAt != null && i.airedAt == null) ?? null;
}

/**
 * After RadioDJ's queue was cleared to evict foreign (AutoDJ) content mid-log: which of
 * our items go back to unpushed, and which are skipped so the log rejoins its timetable.
 *
 * - Un-push: pushed, not aired, and later than the last aired item — those were sitting
 *   in the queue that was just cleared. Earlier pushed-but-unaired items are genuine
 *   skips and stay as they are.
 * - Skip: an unpushed item whose NEXT item was projected to start at or before `now`
 *   has had its whole slot pass. It is marked pushed with aired_at null, the same
 *   "pushed but never aired" state a skip already has. The item whose slot contains
 *   `now` is kept, so the log re-enters at most one song late, which the TOH boundary
 *   logic absorbs.
 */
export function planQueueReset(items: PacingItem[], now: Date): { unpush: PacingItem[]; skip: PacingItem[] } {
  const floor = Math.max(-1, ...items.filter((i) => i.airedAt != null).map((i) => i.sortOrder));
  const unpush = items.filter((i) => ours(i) && i.pushedAt != null && i.airedAt == null && i.sortOrder > floor);
  const unpushIds = new Set(unpush.map((i) => i.id));
  const pending = items.filter((i) => ours(i) && (i.pushedAt == null || unpushIds.has(i.id)));
  const skip: PacingItem[] = [];
  for (let k = 0; k + 1 < pending.length; k++) {
    const nextStart = pending[k + 1].projectedAirAt;
    if (!nextStart || nextStart.getTime() > now.getTime()) break;
    skip.push(pending[k]);
  }
  return { unpush, skip };
}

/**
 * A refresh's result folded into the copy. Rotavox decides which logs exist and what
 * their items are; the Runner keeps the times it holds, whether on the copy or still
 * waiting to be reported. A log Rotavox says is unchanged keeps its items as they are.
 */
export function mergeWindow(cached: CachedLog[], incoming: WindowLog[], pending: Map<string, Times>): CachedLog[] {
  const cachedById = new Map(cached.map((l) => [l.log.id, l]));
  const out: CachedLog[] = [];
  for (const w of incoming) {
    const mine = cachedById.get(w.log.id);
    if (w.items === null) {
      if (mine) out.push({ ...mine, log: w.log });
      continue; // unchanged but no longer held: the next refresh asks for it in full
    }
    const local = new Map<string, Times>(mine?.items.map((i) => [i.id, { pushedAt: i.pushedAt, airedAt: i.airedAt }]));
    out.push({
      log: w.log,
      digest: w.digest,
      items: w.items.map((i) => ({ ...i, ...(local.get(i.id) ?? pending.get(i.id) ?? {}) })),
    });
  }
  return out;
}

// ── The store ───────────────────────────────────────────────────────────────────────

export class LogStore {
  private logs: CachedLog[] = [];
  private pendingTimes = new Map<string, Times>();
  private pendingHistory: HistoryBatch[] = [];
  private historyMark: number | null = null;
  private stationId: string | null = null;
  private refreshedAt: Date | null = null;
  /** Whether this process has confirmed the copy belongs to its key's station. */
  private verified = false;
  private reachable: boolean | null = null;
  private saving: Promise<void> = Promise.resolve();
  private flushing: Promise<void> | null = null;
  private flushAgain = false;
  private readonly now: () => Date;

  constructor(
    private readonly client: Pick<SchedulerClient, "call">,
    private readonly opts: { path: string; say: Say; warn: Say; now?: () => Date },
  ) {
    this.now = opts.now ?? (() => new Date());
  }

  /** Reads the copy saved by the last run. A missing or unreadable file is an empty copy. */
  async load(): Promise<void> {
    let text: string;
    try {
      text = await readFile(this.opts.path, "utf8");
    } catch {
      return;
    }
    try {
      const f = decodeWire<StoreFile>(text);
      this.logs = f.logs;
      this.pendingTimes = new Map(Object.entries(f.pendingTimes));
      this.pendingHistory = f.pendingHistory;
      this.historyMark = f.historyWatermark;
      this.stationId = f.stationId;
      this.refreshedAt = f.refreshedAt;
    } catch (err) {
      this.opts.warn(`[log-copy] ${this.opts.path} is unreadable; starting from an empty copy:`, err);
    }
  }

  /** Brings the copy up to date with Rotavox. Throws if Rotavox can't be reached. */
  async refresh(): Promise<void> {
    if (!this.verified) {
      const { station } = await this.client.call("whoami");
      if (this.stationId && this.stationId !== station.id) {
        this.opts.warn(`[log-copy] the saved copy is another station's; discarding it and its unsent reports.`);
        this.logs = [];
        this.pendingTimes.clear();
        this.pendingHistory = [];
        this.historyMark = null;
      }
      this.stationId = station.id;
      this.verified = true;
    }
    const now = this.now().getTime();
    const { logs } = await this.client.call("logWindow", {
      from: new Date(now - COPY_BEHIND_HOURS * 3_600_000),
      to: new Date(now + COPY_AHEAD_HOURS * 3_600_000),
      have: Object.fromEntries(this.logs.map((l) => [l.log.id, l.digest])),
    });
    const { watermark } = await this.client.call("historyWatermark");
    this.logs = mergeWindow(this.logs, logs, this.pendingTimes);
    this.historyMark = Math.max(this.historyMark ?? 0, watermark);
    this.refreshedAt = this.now();
    this.markReachable(true);
    await this.save();
  }

  /**
   * Sends waiting reports, oldest history first. Never throws; what can't be sent waits.
   * A call while a send is under way gets one more pass after it, so a report made
   * meanwhile isn't left for the next cycle.
   */
  flush(): Promise<void> {
    if (this.flushing) {
      this.flushAgain = true;
      return this.flushing;
    }
    this.flushing = (async () => {
      do {
        this.flushAgain = false;
        await this.send();
      } while (this.flushAgain);
    })().finally(() => (this.flushing = null));
    return this.flushing;
  }

  /** Refreshes every REFRESH_MS and sends reports every FLUSH_MS, for the life of the process. */
  start(): void {
    const every = async (ms: number, fn: () => Promise<void>) => {
      for (;;) {
        await new Promise((r) => setTimeout(r, ms));
        await fn();
      }
    };
    void every(REFRESH_MS, () => this.refresh().catch((err) => this.markReachable(false, err)));
    void every(FLUSH_MS, () => this.flush());
  }

  describe(): string {
    const until = this.coversUntil();
    const waiting = this.pendingTimes.size + this.pendingHistory.length;
    return (
      `${this.logs.length} approved log(s)${until ? ` through ${until.toISOString()}` : ""}` +
      (this.refreshedAt ? `, refreshed ${this.refreshedAt.toISOString()}` : ", never refreshed") +
      (waiting ? `, ${waiting} report(s) waiting` : "")
    );
  }

  coversUntil(): Date | null {
    const ends = this.logs.map((l) => l.log.endsAt.getTime());
    return ends.length ? new Date(Math.max(...ends)) : null;
  }

  // ── Reads ──

  currentLog(at: Date): LogRow | null {
    return pickCurrentLog(this.logs, at)?.log ?? null;
  }

  private items(logId: string): PacingItem[] {
    return this.logs.find((l) => l.log.id === logId)?.items ?? [];
  }

  /** Next item to push: earliest sort_order, unpushed, not a fixed_event. */
  nextUnpushedItem(logId: string): PacingItem | null {
    return unpushedItems(this.items(logId))[0] ?? null;
  }

  /** The next `limit` unpushed items, in order — the cursor rebuild's lookahead. */
  unpushedItems(logId: string, limit: number): PacingItem[] {
    return unpushedItems(this.items(logId)).slice(0, limit);
  }

  /** Whether anything of ours in this log has been pushed — false means a cold takeover. */
  hasPushed(logId: string): boolean {
    return this.items(logId).some((i) => ours(i) && i.pushedAt != null);
  }

  queueDrainInputs(logId: string) {
    return queueDrainInputs(this.items(logId));
  }

  /** Music items in this log, oldest first, with their timing duration — the underrun filler's candidates. */
  fillerCandidates(logId: string): { item: PacingItem; durationMs: number }[] {
    return this.items(logId)
      .filter((i) => i.elementType === "music")
      .map((item) => ({ item, durationMs: item.timingMs }));
  }

  /** The RadioDJ history id reconciliation resumes after, or null before Rotavox has said. */
  historyWatermark(): number | null {
    return this.historyMark;
  }

  // ── Changes: made here, saved, then reported ──

  async markPushed(logId: string, itemIds: string[], at: Date): Promise<void> {
    const ids = new Set(itemIds);
    for (const i of this.items(logId)) if (ids.has(i.id)) this.setTimes(i, { pushedAt: at, airedAt: i.airedAt });
    await this.commit();
  }

  async stampAired(logId: string, rdjSongId: number, airedAt: Date): Promise<boolean> {
    const item = airingCandidate(this.items(logId), rdjSongId);
    if (!item) return false;
    this.setTimes(item, { pushedAt: item.pushedAt, airedAt });
    await this.commit();
    return true;
  }

  /**
   * The history backstop: each reconciled row (chronological) matched in turn, so a song
   * repeated within one batch matches distinct items in order. Correct because RadioDJ
   * plays its queue FIFO and the Runner is the only writer.
   */
  async backfillAired(logId: string, rows: { rdjSongId: number; airedAt: Date }[]): Promise<number> {
    let updated = 0;
    const items = this.items(logId);
    for (const row of rows) {
      const item = airingCandidate(items, row.rdjSongId);
      if (!item) continue;
      this.setTimes(item, { pushedAt: item.pushedAt, airedAt: row.airedAt });
      updated++;
    }
    if (updated) await this.commit();
    return updated;
  }

  async resetAfterQueueClear(logId: string, now: Date): Promise<{ unpushed: number; skipped: number }> {
    const { unpush, skip } = planQueueReset(this.items(logId), now);
    for (const i of unpush) this.setTimes(i, { pushedAt: null, airedAt: null });
    for (const i of skip) this.setTimes(i, { pushedAt: now, airedAt: null });
    await this.commit();
    return { unpushed: unpush.length, skipped: skip.length };
  }

  /** A batch of RadioDJ history, queued for play_history; reconciliation resumes after it. */
  async queueHistory(batch: HistoryBatch): Promise<void> {
    this.pendingHistory.push(batch);
    this.historyMark = Math.max(this.historyMark ?? 0, batch.watermark);
    await this.commit();
  }

  // ── Internals ──

  private setTimes(item: PacingItem, times: Times): void {
    item.pushedAt = times.pushedAt;
    item.airedAt = times.airedAt;
    // A fresh object each time: send() clears an entry only if it is still the one it sent.
    this.pendingTimes.set(item.id, { ...times });
  }

  /** Saved before it is reported, so a crash can lose a report's sending, never the report. */
  private async commit(): Promise<void> {
    await this.save();
    void this.flush();
  }

  private save(): Promise<void> {
    const file: StoreFile = {
      version: 1,
      stationId: this.stationId,
      logs: this.logs,
      pendingTimes: Object.fromEntries(this.pendingTimes),
      pendingHistory: this.pendingHistory,
      historyWatermark: this.historyMark,
      refreshedAt: this.refreshedAt,
    };
    const text = encodeWire(file); // now, so saves land in the order the changes were made
    this.saving = this.saving
      .then(() => replaceFile(this.opts.path, text))
      .catch((err) => this.opts.warn(`[log-copy] could not save ${this.opts.path}:`, err));
    return this.saving;
  }

  private async send(): Promise<void> {
    if (this.pendingHistory.length === 0 && this.pendingTimes.size === 0) return;
    try {
      while (this.pendingHistory.length > 0) {
        await this.client.call("recordHistory", this.pendingHistory[0]);
        this.pendingHistory.shift();
      }
      const sent = [...this.pendingTimes.entries()];
      for (let k = 0; k < sent.length; k += REPORT_CHUNK) {
        const chunk = sent.slice(k, k + REPORT_CHUNK);
        await this.client.call("recordItemTimes", { items: chunk.map(([id, t]) => ({ id, ...t })) });
        for (const [id, t] of chunk) if (this.pendingTimes.get(id) === t) this.pendingTimes.delete(id);
      }
      this.markReachable(true);
    } catch (err) {
      this.markReachable(false, err);
    }
    await this.save();
  }

  private markReachable(ok: boolean, err?: unknown): void {
    if (ok && this.reachable === false) {
      this.opts.say("[log-copy] Rotavox is reachable again; sending what waited.");
    } else if (!ok && this.reachable !== false) {
      const until = this.coversUntil();
      this.opts.warn(
        `[log-copy] can't reach Rotavox (${(err as Error)?.message ?? err}). Pacing continues from the local copy` +
          (until ? `, which runs to ${until.toISOString()}` : ", which is empty — AutoDJ keeps the air") +
          `. Reports wait on disk until Rotavox is back.`,
      );
    }
    this.reachable = ok;
  }
}
