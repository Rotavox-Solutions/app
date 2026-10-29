"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { UnmappedSubcategory } from "@rotavox/schema";
import { input, primaryButton, secondaryButton, send } from "@/components/account/api";

const KINDS = [
  { value: "music", label: "Music" },
  { value: "imaging", label: "Imaging" },
];

const select =
  "rounded border border-neutral-700 bg-neutral-950 px-2 py-2 text-sm text-neutral-100 focus:border-neutral-500 focus:outline-none";

function useCreate() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function create(body: { name: string; kind: string; rdjSubcategoryId?: number }): Promise<boolean> {
    setPending(true);
    setError(null);
    const { error } = await send("/api/categories", "POST", body);
    setPending(false);
    if (error) {
      setError(error);
      return false;
    }
    router.refresh();
    return true;
  }
  return { pending, error, create };
}

/** One RadioDJ subcategory with no category yet: name it, pick its kind, make it. */
function FromSubcategory({ s }: { s: UnmappedSubcategory }) {
  const [name, setName] = useState(s.name);
  const [kind, setKind] = useState<string>(s.suggestedKind);
  const { pending, error, create } = useCreate();
  return (
    <li className="space-y-1 py-3">
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void create({ name, kind, rdjSubcategoryId: s.rdjSubcategoryId });
        }}
      >
        <input className={`${input} max-w-xs`} value={name} onChange={(e) => setName(e.target.value)} required />
        <select className={select} value={kind} onChange={(e) => setKind(e.target.value)}>
          {KINDS.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </select>
        <button className={secondaryButton} disabled={pending}>
          {pending ? "Making…" : "Make category"}
        </button>
        {error && <span className="text-sm text-red-400">{error}</span>}
      </form>
      <p className="text-xs text-neutral-500">
        RadioDJ: {s.parentName ? `${s.parentName} › ` : ""}
        {s.name} · {s.songs === 0 ? "no songs" : `${s.songs} ${s.songs === 1 ? "song" : "songs"} waiting in the Inbox`}
      </p>
    </li>
  );
}

/** A category with no RadioDJ subcategory behind it. */
function Standalone() {
  const [name, setName] = useState("");
  const [kind, setKind] = useState("music");
  const { pending, error, create } = useCreate();
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        if (await create({ name, kind })) setName("");
      }}
    >
      <input
        className={`${input} max-w-xs`}
        placeholder="Name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
      />
      <select className={select} value={kind} onChange={(e) => setKind(e.target.value)}>
        {KINDS.map((k) => (
          <option key={k.value} value={k.value}>
            {k.label}
          </option>
        ))}
      </select>
      <button className={primaryButton} disabled={pending}>
        {pending ? "Making…" : "Make category"}
      </button>
      {error && <span className="text-sm text-red-400">{error}</span>}
    </form>
  );
}

export function NewCategory({ unmapped }: { unmapped: UnmappedSubcategory[] }) {
  return (
    <div className="space-y-4">
      {unmapped.length > 0 && (
        <div className="space-y-1">
          <p className="max-w-2xl text-sm text-neutral-400">
            These RadioDJ subcategories have no category, so the clocks can&apos;t call their songs and the Inbox
            can&apos;t place them. Make one for each that should be a pool; its songs can then be placed where RadioDJ
            already files them, with nothing moving in RadioDJ.
          </p>
          <ul className="divide-y divide-neutral-900">
            {unmapped.map((s) => (
              <FromSubcategory key={s.rdjSubcategoryId} s={s} />
            ))}
          </ul>
        </div>
      )}
      <div className="space-y-2">
        <p className="text-sm text-neutral-400">
          {unmapped.length > 0 ? "Or a category of your own, with no RadioDJ subcategory:" : "A new category:"}
        </p>
        <Standalone />
      </div>
    </div>
  );
}
