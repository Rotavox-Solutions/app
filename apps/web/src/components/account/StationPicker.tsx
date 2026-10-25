"use client";

import { useState } from "react";
import { secondaryButton, send } from "./api";

export function StationPicker({
  stations,
  currentId,
}: {
  stations: { id: string; name: string; role: string }[];
  currentId: string | null;
}) {
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-2">
      <ul className="max-w-xl divide-y divide-neutral-900 text-sm">
        {stations.map((s) => (
          <li key={s.id} className="flex items-center justify-between gap-4 py-2">
            <span>
              <span className="text-neutral-100">{s.name}</span>
              {s.role && <span className="ml-2 text-xs text-neutral-500">{s.role}</span>}
            </span>
            {s.id === currentId ? (
              <span className="text-xs text-neutral-500">working on it now</span>
            ) : (
              <button
                className={secondaryButton}
                onClick={async () => {
                  const { error } = await send("/api/session/station", "POST", { stationId: s.id });
                  if (error) setError(error);
                  else window.location.href = "/today";
                }}
              >
                Open
              </button>
            )}
          </li>
        ))}
      </ul>
      {error && <p className="text-sm text-red-400">{error}</p>}
    </div>
  );
}
