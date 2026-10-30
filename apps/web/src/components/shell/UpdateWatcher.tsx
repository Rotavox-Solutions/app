"use client";

import { useEffect, useState } from "react";

/** Inlined at build (next.config.ts): the commit this page's code is of. */
const BUILT = process.env.ROTAVOX_REVISION || null;
const CHECK_EVERY_MS = 5 * 60_000;

/**
 * Notices when Rotavox has been deployed over a page left open. Moving between pages
 * already loads fresh ones; this covers a tab that sat still across a deploy. It reloads
 * on its own unless something has been typed on the page, which a reload would lose; then
 * it offers the reload instead.
 */
export function UpdateWatcher() {
  const [stale, setStale] = useState(false);

  useEffect(() => {
    if (!BUILT) return; // a dev build outside git has nothing to compare
    let typed = false;
    let done = false;
    const onInput = () => {
      typed = true;
    };

    async function check() {
      if (done || document.visibilityState !== "visible") return;
      let revision: string | null = null;
      try {
        const res = await fetch("/api/version", { cache: "no-store" });
        if (res.ok) revision = (await res.json()).revision ?? null;
      } catch {
        return; // offline or mid-deploy: try again later
      }
      if (!revision || revision === BUILT) return;
      done = true;
      if (typed) setStale(true);
      else window.location.reload();
    }

    document.addEventListener("input", onInput, true);
    document.addEventListener("visibilitychange", check);
    window.addEventListener("focus", check);
    const timer = window.setInterval(check, CHECK_EVERY_MS);
    return () => {
      document.removeEventListener("input", onInput, true);
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("focus", check);
      window.clearInterval(timer);
    };
  }, []);

  if (!stale) return null;
  return (
    <div className="fixed inset-x-0 bottom-0 z-50 flex items-center justify-center gap-3 border-t border-sky-900 bg-sky-950/95 px-4 py-2 text-sm text-sky-100">
      Rotavox was updated since this page loaded.
      <button
        onClick={() => window.location.reload()}
        className="rounded bg-sky-700 px-3 py-0.5 font-medium text-white hover:bg-sky-600"
      >
        Reload
      </button>
    </div>
  );
}
