import { beforeEach, describe, expect, it } from "vitest";
import { approveLog, applyReplace } from "../src/lib/log-edits";
import { resetDb } from "./helpers/db";
import { seedLog, seedLogItem, seedSong, seedStation } from "./helpers/fixtures";

describe("approval state machine", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("draft -> approved via approveLog", async () => {
    const station = await seedStation();
    const log = await seedLog(station.id, { status: "draft" });

    const result = await approveLog(log.id);

    expect(result.log.status).toBe("approved");
  });

  it("approving an already-approved log is idempotent", async () => {
    const station = await seedStation();
    const log = await seedLog(station.id, { status: "approved" });

    const result = await approveLog(log.id);

    expect(result.log.status).toBe("approved");
  });

  it("editing a future (not-yet-airing) approved log flips it back to draft", async () => {
    const station = await seedStation();
    const songA = await seedSong(station.id, 1001);
    const songB = await seedSong(station.id, 1002);
    const now = Date.now();
    const log = await seedLog(station.id, {
      status: "approved",
      startsAt: new Date(now + 3_600_000), // starts in 1h — not airing yet
      endsAt: new Date(now + 2 * 3_600_000),
    });
    const item = await seedLogItem(log.id, {
      songId: songA.id,
      rdjSongId: songA.rdjSongId,
      projectedAirAt: new Date(now + 3_700_000), // well past the safety horizon
    });

    const result = await applyReplace(log.id, item.id, songB.id);

    expect(result.log.status).toBe("draft");
    expect(result.item.songId).toBe(songB.id);
    expect(result.item.rdjSongId).toBe(songB.rdjSongId);
  });

  it("editing an airing log's un-pushed tail applies in place; status stays approved", async () => {
    const station = await seedStation();
    const songA = await seedSong(station.id, 1001);
    const songB = await seedSong(station.id, 1002);
    const now = Date.now();
    const log = await seedLog(station.id, {
      status: "approved",
      startsAt: new Date(now - 3_600_000), // started 1h ago
      endsAt: new Date(now + 3 * 3_600_000), // ends in 3h — currently airing
    });
    const item = await seedLogItem(log.id, {
      songId: songA.id,
      rdjSongId: songA.rdjSongId,
      projectedAirAt: new Date(now + 30 * 60_000), // 30 min out, well past the safety horizon
    });

    const result = await applyReplace(log.id, item.id, songB.id);

    expect(result.log.status).toBe("approved");
    expect(result.item.songId).toBe(songB.id);
    expect(result.item.rdjSongId).toBe(songB.rdjSongId);
  });
});
