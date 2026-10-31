"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { NAV, type NavItem } from "./nav";

function isActive(pathname: string, href: string): boolean {
  if (href === "/station") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export type NavCounts = Partial<Record<NonNullable<NavItem["badge"]>, number>>;

interface Props {
  station: { id: string; name: string; playout: "radiodj" | "file" } | null;
  stations: { id: string; name: string }[];
  user: { name: string; role: string };
  permissions: NonNullable<NavItem["needs"]>[];
  counts?: NavCounts;
}

async function post(url: string, body?: unknown) {
  await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
}

export function Sidebar({ station, stations, user, permissions, counts = {} }: Props) {
  const pathname = usePathname();
  const [busy, setBusy] = useState(false);
  const sections = NAV.map((s) => ({
    ...s,
    items: s.items
      .filter((i) => (!i.needs || permissions.includes(i.needs)) && (!i.playout || i.playout === station?.playout))
      .map((i) => (station?.playout === "file" && i.fileLabel ? { ...i, label: i.fileLabel } : i)),
  })).filter((s) => s.items.length > 0);

  async function switchTo(id: string) {
    setBusy(true);
    await post("/api/session/station", { stationId: id });
    window.location.href = "/today";
  }

  async function signOut() {
    setBusy(true);
    await post("/api/auth/logout");
    window.location.href = "/login";
  }

  return (
    <nav className="flex gap-6 overflow-x-auto text-sm md:flex-col md:gap-5 md:overflow-visible">
      <div className="hidden md:block">
        <div className="text-base font-semibold tracking-tight text-neutral-100">Rotavox</div>
        {stations.length > 1 ? (
          <select
            aria-label="Station"
            value={station?.id ?? ""}
            disabled={busy}
            onChange={(e) => switchTo(e.target.value)}
            className="mt-1 w-full rounded border border-neutral-800 bg-neutral-950 px-1 py-0.5 text-xs text-neutral-300"
          >
            {!station && <option value="">Pick a station…</option>}
            {stations.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        ) : (
          <div className="text-xs text-neutral-500">{station?.name ?? "No station"}</div>
        )}
      </div>
      {station &&
        sections.map((section) => (
          <div key={section.label || "home"} className="flex shrink-0 gap-3 md:flex-col md:gap-0.5">
            {section.label && (
              <div className="hidden px-2 pb-1 text-xs font-medium uppercase tracking-wide text-neutral-600 md:block">
                {section.label}
              </div>
            )}
            {section.items.map((item) =>
              item.href ? (
                <a
                  key={item.label}
                  href={item.href}
                  className={`whitespace-nowrap rounded px-2 py-1 ${
                    isActive(pathname, item.href)
                      ? "bg-neutral-800 text-neutral-100"
                      : "text-neutral-400 hover:bg-neutral-900 hover:text-neutral-100"
                  }`}
                >
                  {item.label}
                  {item.badge && counts[item.badge] ? (
                    <span className="ml-2 rounded bg-neutral-700 px-1.5 text-xs tabular-nums text-neutral-200">
                      {counts[item.badge]}
                    </span>
                  ) : null}
                </a>
              ) : (
                <span
                  key={item.label}
                  className="hidden cursor-default items-center justify-between px-2 py-1 text-neutral-600 md:flex"
                  title="Not built yet"
                >
                  {item.label}
                  <span className="text-[10px] uppercase tracking-wide text-neutral-700">soon</span>
                </span>
              ),
            )}
          </div>
        ))}
      <div className="flex shrink-0 gap-3 border-neutral-900 md:flex-col md:gap-0.5 md:border-t md:pt-4">
        <a
          href="/account"
          className={`whitespace-nowrap rounded px-2 py-1 ${
            isActive(pathname, "/account")
              ? "bg-neutral-800 text-neutral-100"
              : "text-neutral-400 hover:bg-neutral-900 hover:text-neutral-100"
          }`}
        >
          <span className="block text-neutral-200">{user.name}</span>
          {user.role && <span className="hidden text-xs text-neutral-500 md:block">{user.role}</span>}
        </a>
        <button
          type="button"
          onClick={signOut}
          disabled={busy}
          className="whitespace-nowrap rounded px-2 py-1 text-left text-neutral-500 hover:bg-neutral-900 hover:text-neutral-100"
        >
          Sign out
        </button>
      </div>
    </nav>
  );
}
