"use client";

import { usePathname } from "next/navigation";
import { NAV } from "./nav";

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function Sidebar({ stationName }: { stationName: string }) {
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
