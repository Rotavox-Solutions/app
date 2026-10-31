import { libraryFromFile } from "@rotavox/schema";
import { db } from "@/lib/db";
import { allowed, requireStation } from "@/lib/auth";
import { LibraryImport } from "@/components/music/LibraryImport";

// Live view over current DB state — never statically prerendered.
export const dynamic = "force-dynamic";

export default async function LibraryImportPage() {
  const ctx = await requireStation();
  const fromFile = await libraryFromFile(db, ctx.stationId);

  return (
    <div className="space-y-6">
      <div>
        <a href="/music/library" className="text-sm text-neutral-500 hover:text-neutral-300">
          ← Library
        </a>
        <h1 className="mt-1 text-xl font-semibold">Import a library file</h1>
        <p className="mt-1 max-w-2xl text-sm text-neutral-500">
          Export your library from your playout system as CSV and bring it in here. Songs already in Rotavox are updated;
          new ones are added, into their pool where the file names one. Nothing is removed. Re-import whenever the
          library changes.
        </p>
      </div>
      {!fromFile ? (
        <p className="text-sm text-neutral-500">
          This station&apos;s library comes from RadioDJ through the Runner, and syncs on its own every 15 minutes, so
          there&apos;s nothing to import. See{" "}
          <a href="/station" className="underline hover:text-neutral-300">
            Library &amp; Runner
          </a>
          .
        </p>
      ) : !allowed(ctx, "edit_music") ? (
        <p className="text-sm text-neutral-500">Your role at this station doesn&apos;t include changing the library.</p>
      ) : (
        <LibraryImport />
      )}
    </div>
  );
}
