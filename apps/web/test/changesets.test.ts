import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  applyDraft,
  ChangesetError,
  changesets,
  discardDraft,
  draftRevert,
  getDraft,
  lifecycleEvents,
  listAppliedChangesets,
  listPendingProjections,
  songCategories,
  songs,
  stageChanges,
  unstage,
} from "@rotavox/schema";
import { db } from "../src/lib/db";
import { computeImpact, getInbox } from "../src/lib/music-edits";
import { resetDb } from "./helpers/db";
import { seedCategory, seedSong, seedStation } from "./helpers/fixtures";

async function fixture(opts: { imported?: boolean; projected?: boolean } = {}) {
  const station = await seedStation({
    membershipImportedAt: opts.imported === false ? null : new Date("2026-10-20T00:00:00Z"),
    rdjLifecycleSubcats: { 35: { state: "benched", default: true } },
  });
  const ids = (n: number) => (opts.projected === false ? [] : [n]);
  const a1 = await seedCategory(station.id, { name: "A1", rdjSubcategoryIds: ids(5) });
  const r1 = await seedCategory(station.id, { name: "R1", rdjSubcategoryIds: ids(26) });
  const placed = await seedSong(station.id, 1, { artist: "Placed", rdjSubcategoryId: 5 });
  const loose = await seedSong(station.id, 2, { artist: "Loose", rdjSubcategoryId: 39 });
  const mirror = await seedSong(station.id, -3, { artist: "Retired mirror", rdjSubcategoryId: 39 });
  await db.insert(songCategories).values({ songId: placed.id, categoryId: a1.id });
  return { station, a1, r1, placed, loose, mirror };
}

async function placement(songId: string) {
  const [row] = await db.select({ state: songs.lifecycleState }).from(songs).where(eq(songs.id, songId));
  const pools = await db.select().from(songCategories).where(eq(songCategories.songId, songId));
  return { state: row.state, pools: pools.map((p) => p.categoryId) };
}

async function rejects(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toSatisfy((e) => e instanceof ChangesetError && e.code === code);
}

describe("changesets", () => {
  beforeEach(resetDb);

  it("refuses edits before membership is imported, since a re-derive would overwrite them", async () => {
    const { station, loose, a1 } = await fixture({ imported: false });
    await rejects(stageChanges(db, station.id, [{ songId: loose.id, to: { state: "active", categoryId: a1.id } }]), "not_imported");
  });

  it("stages into one draft, and staging a song back where it is removes it", async () => {
    const { station, placed, loose, a1, r1 } = await fixture();
    await stageChanges(db, station.id, [{ songId: loose.id, to: { state: "active", categoryId: a1.id } }]);
    await stageChanges(db, station.id, [{ songId: placed.id, to: { state: "active", categoryId: r1.id } }]);
    let draft = await getDraft(db, station.id);
    expect(draft!.items).toHaveLength(2);

    // Restaging keeps the original precondition.
    await stageChanges(db, station.id, [{ songId: placed.id, to: { state: "resting", categoryId: a1.id } }]);
    draft = await getDraft(db, station.id);
    const item = draft!.items.find((i) => i.songId === placed.id)!;
    expect(item.from).toEqual({ state: "active", categoryId: a1.id });
    expect(item.to).toEqual({ state: "resting", categoryId: a1.id });

    await stageChanges(db, station.id, [{ songId: placed.id, to: { state: "active", categoryId: a1.id } }]);
    draft = await getDraft(db, station.id);
    expect(draft!.items.map((i) => i.songId)).toEqual([loose.id]);

    await unstage(db, station.id, [loose.id]);
    expect((await getDraft(db, station.id))!.items).toHaveLength(0);
  });

  it("drops the pool of a benched song and rejects an active song with none", async () => {
    const { station, placed, loose, a1 } = await fixture();
    await stageChanges(db, station.id, [{ songId: placed.id, to: { state: "benched", categoryId: a1.id } }]);
    expect((await getDraft(db, station.id))!.items[0].to).toEqual({ state: "benched", categoryId: null });
    await rejects(stageChanges(db, station.id, [{ songId: loose.id, to: { state: "active", categoryId: null } }]), "invalid");
  });

  it("applies with an intent, records events, and marks the change for projection", async () => {
    const { station, placed, loose, a1, r1 } = await fixture();
    await stageChanges(db, station.id, [
      { songId: loose.id, to: { state: "active", categoryId: a1.id } },
      { songId: placed.id, to: { state: "active", categoryId: r1.id }, reason: "Peaked" },
    ]);
    await rejects(applyDraft(db, station.id), "intent_required");

    const { changesetId, changed } = await applyDraft(db, station.id, { intent: "October moves" });
    expect(changed).toBe(2);
    expect(await placement(loose.id)).toEqual({ state: "active", pools: [a1.id] });
    expect(await placement(placed.id)).toEqual({ state: "active", pools: [r1.id] });

    const events = await db.select().from(lifecycleEvents).where(eq(lifecycleEvents.sourceRef, changesetId));
    expect(events.map((e) => e.reason).sort()).toEqual(["October moves", "Peaked"]);
    const [cs] = await db.select().from(changesets).where(eq(changesets.id, changesetId));
    expect(cs).toMatchObject({ status: "applied", intent: "October moves", projection: "pending" });
    expect(await getDraft(db, station.id)).toBeNull();

    const pending = await listPendingProjections(db, station.id);
    expect(pending).toHaveLength(1);
    expect(pending[0].mirrorSubcat.get(loose.id)).toBe(39);
  });

  it("does not ask for projection where nothing is mapped to the playout library", async () => {
    const { station, loose, a1 } = await fixture({ projected: false });
    await stageChanges(db, station.id, [{ songId: loose.id, to: { state: "active", categoryId: a1.id } }]);
    const { changesetId } = await applyDraft(db, station.id, { intent: "Tier 0" });
    const [cs] = await db.select().from(changesets).where(eq(changesets.id, changesetId));
    expect(cs.projection).toBeNull();
  });

  it("aborts the whole changeset when a song changed since it was staged", async () => {
    const { station, placed, loose, a1, r1 } = await fixture();
    await stageChanges(db, station.id, [
      { songId: loose.id, to: { state: "active", categoryId: a1.id } },
      { songId: placed.id, to: { state: "active", categoryId: r1.id } },
    ]);
    // Someone moves the song by another path in between.
    await db.update(songs).set({ lifecycleState: "benched" }).where(eq(songs.id, placed.id));

    await expect(applyDraft(db, station.id, { intent: "x" })).rejects.toSatisfy(
      (e) => e instanceof ChangesetError && e.code === "conflict" && e.conflicts.map((c) => c.songId).join() === placed.id
    );
    expect(await placement(loose.id)).toEqual({ state: "active", pools: [] });
    expect((await getDraft(db, station.id))!.items).toHaveLength(2);
  });

  it("undoes through a reviewed draft, once", async () => {
    const { station, placed, a1, r1 } = await fixture();
    await stageChanges(db, station.id, [{ songId: placed.id, to: { state: "active", categoryId: r1.id } }]);
    const { changesetId } = await applyDraft(db, station.id, { intent: "Move to R1" });

    const undo = await draftRevert(db, station.id, changesetId);
    expect(undo.revertsChangesetId).toBe(changesetId);
    expect(undo.items[0]).toMatchObject({
      from: { categoryId: r1.id },
      to: { state: "active", categoryId: a1.id },
      // RadioDJ goes back to exactly the subcategory it was staged from.
      toRdjSubcat: 5,
    });
    expect(await placement(placed.id)).toEqual({ state: "active", pools: [r1.id] });

    await applyDraft(db, station.id);
    expect(await placement(placed.id)).toEqual({ state: "active", pools: [a1.id] });
    await rejects(draftRevert(db, station.id, changesetId), "already_reverted");

    const history = await listAppliedChangesets(db, station.id);
    expect(history.find((h) => h.id === changesetId)).toMatchObject({ revertedById: undo.id, itemCount: 1 });
  });

  it("will not undo over staged work", async () => {
    const { station, placed, loose, a1, r1 } = await fixture();
    await stageChanges(db, station.id, [{ songId: placed.id, to: { state: "active", categoryId: r1.id } }]);
    const { changesetId } = await applyDraft(db, station.id, { intent: "Move" });
    await stageChanges(db, station.id, [{ songId: loose.id, to: { state: "active", categoryId: a1.id } }]);
    await rejects(draftRevert(db, station.id, changesetId), "draft_exists");
    await discardDraft(db, station.id);
    await expect(draftRevert(db, station.id, changesetId)).resolves.toBeTruthy();
  });

  it("keeps one draft per station even under concurrent staging", async () => {
    const { station, placed, loose, a1, r1 } = await fixture();
    await Promise.allSettled([
      stageChanges(db, station.id, [{ songId: loose.id, to: { state: "active", categoryId: a1.id } }]),
      stageChanges(db, station.id, [{ songId: placed.id, to: { state: "active", categoryId: r1.id } }]),
    ]);
    const drafts = await db.select().from(changesets).where(eq(changesets.stationId, station.id));
    expect(drafts.filter((d) => d.status === "draft")).toHaveLength(1);
  });
});

describe("inbox and impact", () => {
  beforeEach(resetDb);

  it("lists active songs with no pool, not the retired mirror, with what is staged", async () => {
    const { station, loose, a1 } = await fixture();
    let inbox = await getInbox(station.id);
    expect(inbox.songs.map((s) => s.id)).toEqual([loose.id]);
    await stageChanges(db, station.id, [{ songId: loose.id, to: { state: "active", categoryId: a1.id } }]);
    inbox = await getInbox(station.id);
    expect(inbox.songs[0].stagedCategoryId).toBe(a1.id);
    await applyDraft(db, station.id, { intent: "Place" });
    expect((await getInbox(station.id)).songs).toHaveLength(0);
  });

  it("reports depth before and after for every pool a change touches", async () => {
    const { station, placed, loose, a1, r1 } = await fixture();
    await stageChanges(db, station.id, [
      { songId: loose.id, to: { state: "active", categoryId: a1.id } },
      { songId: placed.id, to: { state: "resting", categoryId: a1.id } },
    ]);
    let impact = await computeImpact(station.id, (await getDraft(db, station.id))!.items);
    // A1 gains one and rests one: depth is unchanged, resting goes up.
    expect(impact).toEqual([
      expect.objectContaining({
        name: "A1",
        before: expect.objectContaining({ enabledDepth: 1, restingDepth: 0 }),
        after: expect.objectContaining({ enabledDepth: 1, restingDepth: 1 }),
      }),
    ]);

    await stageChanges(db, station.id, [{ songId: placed.id, to: { state: "active", categoryId: r1.id } }]);
    impact = await computeImpact(station.id, (await getDraft(db, station.id))!.items);
    // A1 swaps one song for another, so only R1 actually changes.
    expect(impact.map((r) => [r.name, r.before.enabledDepth, r.after.enabledDepth])).toEqual([["R1", 0, 1]]);
    // A what-if: nothing was written.
    expect(await placement(placed.id)).toEqual({ state: "active", pools: [a1.id] });
  });
});
