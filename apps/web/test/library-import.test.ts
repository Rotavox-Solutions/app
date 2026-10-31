import { beforeEach, describe, expect, it } from "vitest";
import {
  applyImport,

  createRunnerKey,
  detectMapping,
  existingSongs,
  lifecycleEvents,
  parseCsv,
  parseDuration,
  planImport,
  songCategories,
  songs,
  stations,
} from "@rotavox/schema";
import { eq } from "drizzle-orm";
import { db } from "../src/lib/db";
import { resetDb } from "./helpers/db";
import { seedCategory, seedSong, seedStation } from "./helpers/fixtures";

describe("CSV parsing", () => {
  it("reads quotes, doubled quotes, embedded commas and line breaks, CRLF and a BOM", () => {
    const text = '﻿Artist,Title,Length\r\n"Guns N\' Roses","Sweet Child ""O"" Mine, Live",5:56\r\nDjo,"End of\nBeginning",2:39\r\n\r\n';
    expect(parseCsv(text)).toEqual([
      ["Artist", "Title", "Length"],
      ["Guns N' Roses", 'Sweet Child "O" Mine, Live', "5:56"],
      ["Djo", "End of\nBeginning", "2:39"],
    ]);
  });

  it("detects semicolon and tab delimiters from the header", () => {
    expect(parseCsv("Artist;Title\nA;B")).toEqual([["Artist", "Title"], ["A", "B"]]);
    expect(parseCsv("Artist\tTitle\nA\tB, with comma")).toEqual([["Artist", "Title"], ["A", "B, with comma"]]);
  });

  it("maps headers by name, each column once", () => {
    expect(detectMapping(["Song ID", "ARTIST", "Song Title", "Duration (ms)", "File", "Category", "Extra"])).toEqual({
      id: 0, artist: 1, title: 2, duration: 3, path: 4, pool: 5,
    });
  });

  it("reads lengths as m:ss, h:mm:ss, seconds or milliseconds", () => {
    expect(parseDuration("3:45")).toBe(225_000);
    expect(parseDuration("1:03:45")).toBe(3_825_000);
    expect(parseDuration("225")).toBe(225_000);
    expect(parseDuration("225000")).toBe(225_000);
    expect(parseDuration("")).toBeNull();
    expect(parseDuration("soon")).toBeNull();
  });
});

describe("import plan", () => {
  const existing = [
    { id: "s1", rdjSongId: 10, artist: "Deftones", title: "Mountain", album: null, durationMs: 200_000, path: "a.mp3", songType: 0, enabled: true },
    { id: "s2", rdjSongId: 11, artist: "Djo", title: "End", album: null, durationMs: 159_000, path: "b.mp3", songType: 0, enabled: true },
    { id: "s3", rdjSongId: 12, artist: "Gone", title: "Away", album: null, durationMs: 1, path: "c.mp3", songType: 0, enabled: true },
  ];

  it("matches by id when there is one, and says what would change", () => {
    const rows = parseCsv("id,artist,title,length,category\n10,Deftones,Mountain,3:20,A1\n11,Djo,End of Beginning,2:39,A1\n99,New Band,New Song,3:00,R1\nx,Bad,Id,1:00,\n99,Dupe,Song,1:00,");
    const plan = planImport(rows, detectMapping(rows[0]), existing);
    expect(plan.matchBy).toBe("id");
    expect(plan.counts).toEqual({ create: 1, update: 1, unchanged: 1, skip: 2 });
    expect(plan.rows.map((r) => [r.line, r.action, r.changes, r.reason])).toEqual([
      [2, "unchanged", [], null],
      [3, "update", ["title"], null],
      [4, "create", [], null],
      [5, "skip", [], '"x" isn\'t a song number'],
      [6, "skip", [], "listed twice in the file"],
    ]);
    expect(plan.notInFile).toBe(1);
  });

  it("falls back to the file path, then artist and title, and to a title from the file name", () => {
    const byPath = parseCsv("path,artist\nA.MP3,Deftones\nnew/Some Track.mp3,Someone");
    const plan = planImport(byPath, detectMapping(byPath[0]), existing);
    expect(plan.matchBy).toBe("path");
    expect(plan.rows.map((r) => [r.action, r.song.title])).toEqual([
      ["update", "A"],
      ["create", "Some Track"],
    ]);
    const byName = parseCsv("artist,title\ndeftones,MOUNTAIN");
    expect(planImport(byName, detectMapping(byName[0]), existing).rows[0].action).toBe("update");
  });

  it("refuses a file with no title or path column", () => {
    const rows = parseCsv("artist,album\nA,B");
    expect(planImport(rows, detectMapping(rows[0]), existing).problems[0]).toMatch(/title/);
  });
});

describe("applying an import", () => {
  beforeEach(resetDb);

  it("updates matched songs, adds new ones into their pool or the Inbox, and takes over the pools", async () => {
    const station = await seedStation({ playout: "file" });
    const a1 = await seedCategory(station.id, { name: "A1" });
    await seedSong(station.id, 10, { artist: "Deftones", title: "Mountain" });
    const rows = parseCsv("id,artist,title,category\n10,Deftones,Mountain (Edit),A1\n,New Band,Into A1,a1\n,Other,Nowhere,Z9");
    const plan = planImport(rows, detectMapping(rows[0]), await existingSongs(db, station.id));
    expect(plan.counts).toMatchObject({ update: 1, create: 2 });

    const result = await applyImport(db, station.id, plan);
    expect(result).toEqual({ created: 2, updated: 1, placed: 1, toInbox: 1 });
    const all = await db.select().from(songs).where(eq(songs.stationId, station.id));
    expect(all.map((s) => [s.rdjSongId, s.title]).sort()).toEqual([[10, "Mountain (Edit)"], [11, "Into A1"], [12, "Nowhere"]]);
    const placed = await db.select().from(songCategories).where(eq(songCategories.categoryId, a1.id));
    expect(placed).toHaveLength(1);
    expect(await db.select().from(lifecycleEvents)).toHaveLength(2);
    const [st] = await db.select().from(stations).where(eq(stations.id, station.id));
    expect(st.membershipImportedAt).not.toBeNull();

  });

  it("refuses a RadioDJ station, and a file station once it has a Runner", async () => {
    const rows = parseCsv("artist,title\nA,B");
    const plan = planImport(rows, detectMapping(rows[0]), []);
    const rdj = await seedStation();
    await expect(applyImport(db, rdj.id, plan)).rejects.toMatchObject({ code: "invalid" });
    const file = await seedStation({ playout: "file" });
    await createRunnerKey(db, { stationId: file.id, label: "Box", createdBy: null });
    await expect(applyImport(db, file.id, plan)).rejects.toMatchObject({ code: "invalid" });
  });
});
