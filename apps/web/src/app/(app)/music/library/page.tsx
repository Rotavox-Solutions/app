import { LibraryTable } from "@/components/music/LibraryTable";
import { groupOptions } from "@/components/music/format";
import { LIFECYCLE_STATES } from "@rotavox/schema";
import { LIBRARY_PAGE_SIZE, parseLibraryFilter, searchLibrary, type LibraryFilter } from "@/lib/library";
import { getPlaceableCategories, getPoolEditing, suggestedRestExit } from "@/lib/music-edits";
import { RECENT_SPINS_DAYS } from "@/lib/queries";
import { directionsFor } from "@/lib/direction";
import { allowed, requireStation } from "@/lib/auth";

// Live view over current DB state — never statically prerendered.
export const dynamic = "force-dynamic";

function href(filter: LibraryFilter, page: number): string {
  const p = new URLSearchParams();
  if (filter.q) p.set("q", filter.q);
  if (filter.state) p.set("state", filter.state);
  if (filter.pool) p.set("pool", filter.pool);
  if (page > 1) p.set("page", String(page));
  const s = p.toString();
  return `/music/library${s ? `?${s}` : ""}`;
}

export default async function LibraryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireStation();
  const { stationId } = ctx;
  const filter = parseLibraryFilter(await searchParams);
  const [result, options, editing] = await Promise.all([
    searchLibrary(stationId, filter),
    getPlaceableCategories(stationId),
    getPoolEditing(stationId),
  ]);
  const directions = await directionsFor(stationId, result.rows);
  const canEdit = allowed(ctx, "edit_music");
  const stagedCount = Object.keys(editing.staged).length;
  const first = (result.page - 1) * LIBRARY_PAGE_SIZE + 1;
  const field = "rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm text-neutral-100";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Library</h1>
        <p className="mt-1 max-w-2xl text-sm text-neutral-500">
          Every song the station holds, in a pool or not. Open a song for its history. Changes stage like everywhere
          else; nothing changes until you apply them.
        </p>
      </div>

      <form method="get" className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          name="q"
          defaultValue={filter.q}
          placeholder="Artist, title or album…"
          className={`${field} w-full sm:w-72`}
        />
        <select name="state" defaultValue={filter.state ?? ""} className={field} aria-label="State">
          <option value="">Any state</option>
          {LIFECYCLE_STATES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select name="pool" defaultValue={filter.pool ?? ""} className={field} aria-label="Pool">
          <option value="">Any pool</option>
          <option value="none">No pool</option>
          {groupOptions(options).map(([group, opts]) => (
            <optgroup key={group} label={group}>
              {opts.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <button className="rounded border border-neutral-700 px-3 py-1 text-sm text-neutral-200 hover:bg-neutral-900">
          Search
        </button>
        {(filter.q || filter.state || filter.pool) && (
          <a href="/music/library" className="text-sm text-neutral-500 hover:text-neutral-300">
            Clear
          </a>
        )}
        {stagedCount > 0 && (
          <a href="/music/changes" className="text-sm text-neutral-300 hover:underline">
            {stagedCount} staged — review changes →
          </a>
        )}
      </form>

      {!editing.imported && canEdit && (
        <p className="text-sm text-neutral-500">
          Pools for this station still come from RadioDJ&apos;s subcategories. Import them on the{" "}
          <a href="/station" className="underline hover:text-neutral-300">
            Station
          </a>{" "}
          page to change songs here.
        </p>
      )}

      {result.total === 0 ? (
        <p className="text-sm text-neutral-500">No song matches.</p>
      ) : (
        <>
          <p className="text-sm text-neutral-500">
            {result.total === 1
              ? "1 song"
              : `${first}–${first + result.rows.length - 1} of ${result.total.toLocaleString("en-US")} songs`}
          </p>
          <LibraryTable
            rows={result.rows}
            options={options}
            staged={editing.staged}
            restExit={suggestedRestExit(options)}
            spinsDays={RECENT_SPINS_DAYS}
            directions={directions}
            readOnly={!editing.imported || !canEdit}
          />
          {result.pageCount > 1 && (
            <nav className="flex items-center gap-4 text-sm">
              {result.page > 1 ? (
                <a href={href(filter, result.page - 1)} className="text-neutral-300 hover:underline">
                  ← Previous
                </a>
              ) : (
                <span className="text-neutral-700">← Previous</span>
              )}
              <span className="text-neutral-500">
                Page {result.page} of {result.pageCount}
              </span>
              {result.page < result.pageCount ? (
                <a href={href(filter, result.page + 1)} className="text-neutral-300 hover:underline">
                  Next →
                </a>
              ) : (
                <span className="text-neutral-700">Next →</span>
              )}
            </nav>
          )}
        </>
      )}
    </div>
  );
}
