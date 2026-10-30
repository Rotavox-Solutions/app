"use client";

import type { CategoryOption } from "@/lib/music-edits";
import { groupOptions } from "./format";

/** A pool picker, grouped by groupOptions. */
export function CategoryPicker({
  options,
  value,
  onChange,
  placeholder = "Place in…",
  disabled,
}: {
  options: CategoryOption[];
  value: string;
  onChange: (categoryId: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm text-neutral-100 disabled:opacity-50"
    >
      <option value="">{placeholder}</option>
      {groupOptions(options).map(([label, opts]) => (
        <optgroup key={label} label={label}>
          {opts.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}
