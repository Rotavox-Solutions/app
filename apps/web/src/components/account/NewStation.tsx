"use client";

import { useEffect, useState } from "react";
import { input, label, primaryButton, send } from "./api";

const PLAYOUT_CHOICES = [
  {
    value: "file",
    label: "Exports logs to its own playout system",
    help: "The station imports its library from a file and loads each log Rotavox makes into its playout system. Approved logs count as aired.",
  },
  {
    value: "radiodj",
    label: "RadioDJ, with a Runner on the broadcast box",
    help: "The Runner syncs the library from RadioDJ and paces logs into it. Make its key on the Station page once the station exists.",
  },
] as const;

/** Staff set up a station, then land on it to carry on with its setup. */
export function NewStation({ timeZones }: { timeZones: string[] }) {
  const [name, setName] = useState("");
  const [timezone, setTimezone] = useState("");
  const [playout, setPlayout] = useState<"file" | "radiodj">("file");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Start from the staff member's own zone; most stations are set up by someone nearby.
  useEffect(() => {
    const own = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (own && timeZones.includes(own)) setTimezone((tz) => tz || own);
  }, [timeZones]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const { error } = await send("/api/staff/stations", "POST", { name, timezone, playout });
    if (error) {
      setError(error);
      setPending(false);
    } else window.location.assign("/station");
  }

  return (
    <form onSubmit={submit} className="max-w-xl space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={label}>
          <span>Name</span>
          <input className={input} required maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className={label}>
          <span>Time zone</span>
          <select className={input} required value={timezone} onChange={(e) => setTimezone(e.target.value)}>
            <option value="">Choose…</option>
            {timeZones.map((tz) => (
              <option key={tz} value={tz}>
                {tz.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </label>
      </div>
      <fieldset className="space-y-2 text-sm">
        <legend className="mb-1 text-neutral-300">How logs reach air</legend>
        {PLAYOUT_CHOICES.map((c) => (
          <label key={c.value} className="flex gap-2">
            <input
              type="radio"
              name="playout"
              value={c.value}
              checked={playout === c.value}
              onChange={() => setPlayout(c.value)}
              className="mt-1"
            />
            <span>
              <span className="text-neutral-200">{c.label}</span>
              <span className="block text-xs text-neutral-500">{c.help}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <p className="text-xs text-neutral-500">
        The time zone is hard to change once the format is built: every grid hour and log is in it.
      </p>
      <button className={primaryButton} disabled={pending}>
        {pending ? "Setting up…" : "Set up station"}
      </button>
      {error && <p className="text-sm text-red-400">{error}</p>}
    </form>
  );
}
