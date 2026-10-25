"use client";

import { usePathname } from "next/navigation";
import { NAV, type NavItem } from "./nav";

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export type NavCounts = Partial<Record<NonNullable<NavItem["badge"]>, number>>;

export function Sidebar({ stationName, counts = {} }: { stationName: string; counts?: NavCounts }) {
  const pathname = usePathname();

  return (
    <nav className="flex gap-6 overflow-x-auto text-sm md:flex-col md:gap-5 md:overflow-visible">
      <div className="hidden md:block">
        <div className="text-base font-semibold tracking-tight text-neutral-100">Rotavox</div>
        <div className="text-xs text-neutral-500">{stationName}</div>
      </div>
      {NAV.map((section) => (
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
            )
          )}
        </div>
      ))}
    </nav>
  );
}
