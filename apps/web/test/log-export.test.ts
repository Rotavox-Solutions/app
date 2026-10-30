import { beforeEach, describe, expect, it } from "vitest";
import { logItems } from "@rotavox/schema";
import { db } from "../src/lib/db";
import { exportLog } from "../src/lib/log-export";
import { resetDb } from "./helpers/db";
import { seedLog, seedSong, seedStation } from "./helpers/fixtures";

describe("log export", () => {
  beforeEach(resetDb);

  async function seed() {
    const station = await seedStation({ name: "Demo FM", timezone: "America/New_York" });
    // 14:00 UTC is 10:00 in New York in October (EDT).
    const startsAt = new Date("2026-10-30T14:00:00Z");
    const log = await seedLog(station.id, { startsAt, endsAt: new Date("2026-10-30T15:00:00Z"), status: "approved" });
    const song = await seedSong(station.id, 1234, {
      artist: 'Guns N\' Roses', title: 'Sweet Child "O" Mine, Live', album: "Lies", path: "D:\\Music\\gnr.mp3",
      durationMs: 356_000, effectiveDurationMs: 351_000,
    });
    await db.insert(logItems).values([
      { logId: log.id, sortOrder: 0, elementType: "music", songId: song.id, rdjSongId: 1234, projectedAirAt: startsAt },
      { logId: log.id, sortOrder: 1, elementType: "fixed_event", projectedAirAt: new Date("2026-10-30T14:05:51Z") },
    ]);
    return { station, log };
  }

  it("writes CSV with station-local times and escaped fields", async () => {
    const { station, log } = await seed();
    const file = (await exportLog(station.id, log.id, "csv"))!;
    expect(file.filename).toBe("rotavox-log-2026-10-30-1000.csv");
    const [header, music, fixed] = file.body.trim().split("\r\n");
    expect(header).toBe("local_date,local_time,scheduled_at,sort_order,element_type,category,artist,title,album,duration_seconds,rdj_song_id,path");
    expect(music).toBe('2026-10-30,10:00:00,2026-10-30 14:00:00,0,music,,Guns N\' Roses,"Sweet Child ""O"" Mine, Live",Lies,351,1234,D:\\Music\\gnr.mp3');
    expect(fixed.startsWith("2026-10-30,10:05:51,")).toBe(true);
  });

  it("writes M3U with paths only, and names a draft as one", async () => {
    const { station, log } = await seed();
    const m3u = (await exportLog(station.id, log.id, "m3u"))!;
    expect(m3u.body.split("\r\n").slice(0, 4)).toEqual([
      "#EXTM3U",
      "#PLAYLIST:Rotavox 2026-10-30 10:00",
      '#EXTINF:351,Guns N\' Roses - Sweet Child "O" Mine, Live',
      "D:\\Music\\gnr.mp3",
    ]);
    const draft = await seedLog(station.id, { startsAt: new Date("2026-10-31T14:00:00Z"), endsAt: new Date("2026-10-31T15:00:00Z") });
    expect((await exportLog(station.id, draft.id, "csv"))!.filename).toBe("rotavox-log-2026-10-31-1000-DRAFT.csv");
  });

  it("won't export another station's log", async () => {
    const { log } = await seed();
    const other = await seedStation({ name: "Other" });
    expect(await exportLog(other.id, log.id, "csv")).toBeNull();
  });
});
