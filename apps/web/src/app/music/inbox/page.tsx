import { getInbox, getPlaceableCategories } from "@/lib/music-edits";
import { stationId } from "@/lib/station";
import { InboxTable } from "@/components/music/InboxTable";

// Live view over current DB state — never statically prerendered.
export const dynamic = "force-dynamic";

export default async function InboxPage() {
  const [inbox, options] = await Promise.all([getInbox(stationId), getPlaceableCategories(stationId)]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Inbox</h1>
        <p className="mt-1 max-w-2xl text-sm text-neutral-500">
          Songs in the library with no pool. The clocks can&apos;t schedule them until they have one. Placing a song
          stages it; nothing changes until you apply the changes.
        </p>
      </div>

      {!inbox.imported ? (
        <p className="rounded border border-amber-900/60 bg-amber-950/30 p-4 text-sm text-amber-200">
          Pool membership for this station still comes from RadioDJ subcategories. Run{" "}
          <code className="text-amber-100">import-membership</code> on the Runner before placing songs here.
        </p>
      ) : inbox.songs.length === 0 ? (
        <p className="text-sm text-neutral-500">Every song has a pool.</p>
      ) : (
        <InboxTable songs={inbox.songs} options={options} />
      )}
    </div>
  );
}
