import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decodeWire, encodeWire, type LogRow, type PacingItem, type WindowLog } from "@rotavox/schema";
import { LogStore, mergeWindow, pickCurrentLog, planQueueReset } from "../src/log-store.js";

/**
 * The copy is what keeps a station on air through a Rotavox outage, so the outage is
 * what's tested: Rotavox is a fake that can be switched off, and every call goes through
 * the real wire format, as it does over HTTP.
 */

const T0 = new Date("2026-10-26T15:00:00Z").getTime();
const at = (min: number) => new Date(T0 + min * 60_000);

function log(id: string, overrides: Partial<LogRow> = {}): LogRow {
  return {
    id,
    stationId: "st-1",
    startsAt: at(-30),
    endsAt: at(30),
    status: "approved",
    generatedAt: at(-120),
    generatorVersion: "test",
    seed: null,
    ...overrides,
  };
}

function item(logId: string, sortOrder: number, overrides: Partial<PacingItem> = {}): PacingItem {
  return {
    id: `${logId}-i${sortOrder}`,
    logId,
    sortOrder,
    projectedAirAt: at(sortOrder * 3),
    elementType: "music",
    songId: null,
    rdjSongId: 100 + sortOrder,
    clockPositionId: null,
    violations: null,
    locked: false,
    pushedAt: null,
    airedAt: null,
    timingMs: 180_000,
    tohLocked: false,
    ...overrides,
  };
}

/** A Rotavox that serves one window of logs and records what it is told. */
function fakeRotavox(window: () => WindowLog[]) {
  const state = {
    online: true,
    stationId: "st-1",
    historyWatermark: 40,
    calls: [] as { op: string; args: any }[],
  };
  const client = {
    async call(op: string, args?: unknown): Promise<any> {
      if (!state.online) throw new Error("unreachable (fetch failed)");
      const a = decodeWire<any>(encodeWire(args ?? {}));
      state.calls.push({ op, args: a });
      const result = (() => {
        switch (op) {
          case "whoami":
            return { station: { id: state.stationId, name: "Test FM", timezone: "UTC" }, apiVersion: 1 };
          case "logWindow":
            return {
              logs: window().map((w) => (a.have?.[w.log.id] === w.digest ? { ...w, items: null } : w)),
            };
          case "historyWatermark":
            return { watermark: state.historyWatermark };
          case "recordItemTimes":
            return { updated: a.items.length };
          case "recordHistory":
            return { recorded: a.rows.length };
          default:
            throw new Error(`unexpected op ${op}`);
        }
      })();
      return decodeWire(encodeWire(result));
    },
  };
  const sent = (op: string) => state.calls.filter((c) => c.op === op).map((c) => c.args);
  return { state, client: client as any, sent };
}

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "rotavox-log-store-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const quiet = () => {};
const newStore = (client: any, now = () => at(0)) =>
  new LogStore(client, { path: path.join(dir, "runner-state.json"), say: quiet, warn: quiet, now });

describe("the log copy", () => {
  it("paces from the copy, skipping fixed events, and reports each change", async () => {
    const items = [item("L", 0, { elementType: "fixed_event" }), item("L", 1), item("L", 2)];
    const rv = fakeRotavox(() => [{ log: log("L"), digest: "d1", items }]);
    const store = newStore(rv.client);
    await store.refresh();

    expect(store.currentLog(at(0))?.id).toBe("L");
    expect(store.currentLog(at(31))).toBeNull();
    expect(store.nextUnpushedItem("L")?.id).toBe("L-i1");
    expect(store.hasPushed("L")).toBe(false);

    await store.markPushed("L", ["L-i1"], at(1));
    expect(store.nextUnpushedItem("L")?.id).toBe("L-i2");
    expect(store.queueDrainInputs("L")).toEqual({ pendingMs: 180_000, playingEndsAtMs: null });
    expect(await store.stampAired("L", 101, at(2))).toBe(true);
    expect(await store.stampAired("L", 101, at(3))).toBe(false); // already aired
    expect(store.queueDrainInputs("L").playingEndsAtMs).toBe(at(2).getTime() + 180_000);

    await store.flush();
    const reports = rv.sent("recordItemTimes").flatMap((a) => a.items);
    expect(reports.at(-1)).toEqual({ id: "L-i1", pushedAt: at(1), airedAt: at(2) });
    expect(store.describe()).not.toMatch(/waiting/);
  });

  it("keeps pacing through an outage, saves what happened, and sends it when Rotavox is back", async () => {
    const rv = fakeRotavox(() => [{ log: log("L"), digest: "d1", items: [item("L", 1), item("L", 2)] }]);
    const store = newStore(rv.client);
    await store.refresh();

    rv.state.online = false;
    await store.markPushed("L", ["L-i1"], at(1));
    await store.stampAired("L", 101, at(2));
    await store.flush();
    await expect(store.refresh()).rejects.toThrow(/unreachable/);
    expect(store.nextUnpushedItem("L")?.id).toBe("L-i2");
    expect(store.describe()).toMatch(/1 report\(s\) waiting/);

    // The process restarts mid-outage: the copy and the waiting report come back from disk.
    const restarted = newStore(rv.client);
    await restarted.load();
    expect(restarted.currentLog(at(0))?.id).toBe("L");
    expect(restarted.nextUnpushedItem("L")?.id).toBe("L-i2");

    rv.state.online = true;
    await restarted.flush();
    expect(rv.sent("recordItemTimes").flatMap((a) => a.items)).toEqual([
      { id: "L-i1", pushedAt: at(1), airedAt: at(2) },
    ]);
    expect(restarted.describe()).not.toMatch(/waiting/);
  });

  it("sends history before item times, in order, and resumes reconciliation after the newest batch", async () => {
    const rv = fakeRotavox(() => []);
    const store = newStore(rv.client);
    expect(store.historyWatermark()).toBeNull(); // unknown until Rotavox or the file says
    await store.refresh();
    expect(store.historyWatermark()).toBe(40);

    rv.state.online = false;
    const row = (id: number) => ({ rdjHistoryId: id, rdjSongId: 7, artist: null, airedAt: at(id - 40) });
    await store.queueHistory({ watermark: 41, rows: [row(41)] });
    await store.queueHistory({ watermark: 42, rows: [row(42)] });
    expect(store.historyWatermark()).toBe(42);

    rv.state.online = true;
    await store.flush();
    expect(rv.sent("recordHistory").map((b) => b.watermark)).toEqual([41, 42]);
  });

  it("doesn't clear a report that changed while it was being sent", async () => {
    const rv = fakeRotavox(() => [{ log: log("L"), digest: "d1", items: [item("L", 1)] }]);
    const store = newStore(rv.client);
    await store.refresh();
    const original = rv.client.call;
    let stampDuringSend: Promise<boolean> | null = null;
    rv.client.call = async (op: string, args: any) => {
      if (op === "recordItemTimes" && !stampDuringSend) stampDuringSend = store.stampAired("L", 101, at(2));
      return original(op, args);
    };
    await store.markPushed("L", ["L-i1"], at(1));
    await store.flush();
    await stampDuringSend;
    await store.flush();
    expect(
      rv
        .sent("recordItemTimes")
        .flatMap((a) => a.items)
        .at(-1),
    ).toEqual({
      id: "L-i1",
      pushedAt: at(1),
      airedAt: at(2),
    });
  });

  it("discards a saved copy that belongs to another station", async () => {
    let station = "st-1";
    const rv = fakeRotavox(() => (station === "st-1" ? [{ log: log("L"), digest: "d1", items: [item("L", 1)] }] : []));
    const first = newStore(rv.client);
    await first.refresh();
    rv.state.online = false;
    await first.markPushed("L", ["L-i1"], at(1));

    // The box is given another station's key.
    rv.state.online = true;
    rv.state.stationId = station = "st-2";
    const second = newStore(rv.client);
    await second.load();
    await second.refresh();
    await second.flush();
    expect(second.currentLog(at(0))).toBeNull();
    expect(rv.sent("recordItemTimes")).toEqual([]);
  });
});

describe("refreshing the copy", () => {
  it("takes Rotavox's content and keeps the Runner's times", () => {
    const pushed = item("L", 1, { pushedAt: at(1) });
    const cached = [{ log: log("L"), digest: "d1", items: [pushed, item("L", 2)] }];
    // A PD replaced item 2's song; Rotavox hasn't heard yet that item 1 was pushed.
    const incoming: WindowLog[] = [
      { log: log("L"), digest: "d2", items: [item("L", 1), item("L", 2, { rdjSongId: 999 })] },
    ];
    const [merged] = mergeWindow(cached, incoming, new Map());
    expect(merged.items.map((i) => [i.rdjSongId, i.pushedAt])).toEqual([
      [101, at(1)],
      [999, null],
    ]);
    expect(merged.digest).toBe("d2");
  });

  it("keeps an unchanged log's items, and drops a log Rotavox no longer lists", () => {
    const cached = [
      { log: log("L"), digest: "d1", items: [item("L", 1, { pushedAt: at(1) })] },
      { log: log("M", { startsAt: at(30), endsAt: at(90) }), digest: "d9", items: [item("M", 1)] },
    ];
    const merged = mergeWindow(cached, [{ log: log("L"), digest: "d1", items: null }], new Map());
    expect(merged).toHaveLength(1);
    expect(merged[0].items[0].pushedAt).toEqual(at(1));
  });

  it("picks the most recently generated of overlapping approved logs, and ignores drafts", () => {
    const logs = [
      { log: log("old", { generatedAt: at(-200) }), digest: "", items: [] },
      { log: log("new", { generatedAt: at(-100) }), digest: "", items: [] },
      { log: log("draft", { status: "draft", generatedAt: at(-50) }), digest: "", items: [] },
    ];
    expect(pickCurrentLog(logs, at(0))?.log.id).toBe("new");
  });
});

describe("resetting after the queue was cleared", () => {
  it("re-queues what was cleared and skips slots that have gone by", () => {
    const items = [
      item("L", 0, { pushedAt: at(-10), airedAt: at(-9) }),
      item("L", 1, { pushedAt: at(-8) }), // was in the cleared queue
      item("L", 2, { pushedAt: at(-7) }), // so was this
      item("L", 3),
      item("L", 4),
    ];
    // Item n is due at minute 3n. At minute 7, item 1's slot has passed; item 2's hasn't.
    const { unpush, skip } = planQueueReset(items, at(7));
    expect(unpush.map((i) => i.sortOrder)).toEqual([1, 2]);
    expect(skip.map((i) => i.sortOrder)).toEqual([1]);
  });

  it("leaves an earlier pushed-but-unaired item alone: that was a skip", () => {
    const items = [
      item("L", 0, { pushedAt: at(-10) }),
      item("L", 1, { pushedAt: at(-8), airedAt: at(-5) }),
      item("L", 2, { pushedAt: at(-4) }),
    ];
    expect(planQueueReset(items, at(-20)).unpush.map((i) => i.sortOrder)).toEqual([2]);
  });
});
