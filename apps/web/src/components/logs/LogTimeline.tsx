"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { LogItemDetail } from "@/lib/queries";
import type { DisplayStatus, EditRejectReason } from "@/lib/log-edits";
import { StatusBadge } from "./ViolationBadge";
import { ReplaceModal } from "./ReplaceModal";

function fmtTime(date: Date | string | null): string {
  if (!date) return "—";
  return new Date(date).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function deltaLabel(projected: Date | string | null, aired: Date | string | null): string | null {
  if (!projected || !aired) return null;
  const delta = Math.round((new Date(aired).getTime() - new Date(projected).getTime()) / 1000);
  if (delta === 0) return "on time";
  return delta > 0 ? `+${delta}s` : `${delta}s`;
}

const REASON_LABEL: Record<EditRejectReason, string> = {
  not_found: "not found",
  fixed_event: "fixed event — never editable",
  already_pushed: "already pushed to RadioDJ",
  within_safety_horizon: "airing too soon to edit safely",
  locked: "locked — unlock first",
  song_not_found: "song not found",
};

interface Props {
  logId: string;
  logStatus: "draft" | "approved";
  displayStatus: DisplayStatus;
  items: LogItemDetail[];
}

export function LogTimeline({ logId, logStatus, displayStatus, items }: Props) {
  const router = useRouter();
  const [swapSelection, setSwapSelection] = useState<string[]>([]);
  const [replaceTarget, setReplaceTarget] = useState<{ itemId: string; categoryId: string | null } | null>(null);
  const [pendingApprove, setPendingApprove] = useState(false);
  const [pendingSwap, setPendingSwap] = useState(false);
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);

  async function handleApprove() {
    setPendingApprove(true);
    try {
      await fetch(`/api/logs/${logId}/approve`, { method: "POST" });
      router.refresh();
    } finally {
      setPendingApprove(false);
    }
  }

  async function handleLockToggle(itemId: string, locked: boolean) {
    const res = await fetch(`/api/logs/${logId}/items/${itemId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locked: !locked }),
    });
    if (!res.ok) {
      const body = await res.json();
      setRowError({ id: itemId, message: body.error ?? "failed" });
      return;
    }
    router.refresh();
  }

  function toggleSwapSelect(itemId: string) {
    setSwapSelection((prev) => {
      if (prev.includes(itemId)) return prev.filter((id) => id !== itemId);
      if (prev.length >= 2) return [prev[1], itemId];
      return [...prev, itemId];
    });
  }

  async function handleSwap() {
    if (swapSelection.length !== 2) return;
    setPendingSwap(true);
    try {
      const res = await fetch(`/api/logs/${logId}/items/swap`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemIdA: swapSelection[0], itemIdB: swapSelection[1] }),
      });
      if (!res.ok) {
        const body = await res.json();
        setRowError({ id: swapSelection[0], message: body.error ?? "failed" });
        return;
      }
      setSwapSelection([]);
      router.refresh();
    } finally {
      setPendingSwap(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <StatusBadge status={displayStatus} />
        <button
          onClick={handleApprove}
          disabled={pendingApprove || logStatus === "approved"}
          className="rounded bg-blue-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-600 disabled:opacity-40"
        >
          {logStatus === "approved" ? "Approved" : pendingApprove ? "Approving…" : "Approve"}
        </button>
        {swapSelection.length === 2 && (
          <button
            onClick={handleSwap}
            disabled={pendingSwap}
            className="rounded bg-purple-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-purple-600 disabled:opacity-40"
          >
            {pendingSwap ? "Swapping…" : "Swap selected"}
          </button>
        )}
      </div>

      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-neutral-800 text-neutral-400">
            <th className="py-2 pr-2 font-medium">#</th>
            <th className="py-2 pr-2 font-medium">Projected</th>
            <th className="py-2 pr-2 font-medium">Aired</th>
            <th className="py-2 pr-2 font-medium">Type</th>
            <th className="py-2 pr-2 font-medium">Category</th>
            <th className="py-2 pr-2 font-medium">Song</th>
            <th className="py-2 pr-2 font-medium">Violations</th>
            <th className="py-2 font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const delta = deltaLabel(item.projectedAirAt, item.airedAt);
            const violationSteps = Array.isArray(item.violations)
              ? (item.violations as { step: string }[]).map((v) => v.step)
              : [];
            const disabledTitle = item.editReason ? REASON_LABEL[item.editReason] : undefined;
            const selected = swapSelection.includes(item.id);

            return (
              <tr key={item.id} className={`border-b border-neutral-900 ${selected ? "bg-purple-950/30" : ""}`}>
                <td className="py-1.5 pr-2 text-neutral-500">{item.sortOrder}</td>
                <td className="py-1.5 pr-2 text-neutral-300">{fmtTime(item.projectedAirAt)}</td>
                <td className="py-1.5 pr-2">
                  {item.airedAt ? (
                    <span className={delta && delta !== "on time" ? "text-amber-400" : "text-emerald-400"}>
                      {fmtTime(item.airedAt)} {delta && `(${delta})`}
                    </span>
                  ) : (
                    <span className="text-neutral-600">—</span>
                  )}
                </td>
                <td className="py-1.5 pr-2 text-neutral-400">{item.elementType}</td>
                <td className="py-1.5 pr-2 text-neutral-400">{item.categoryName ?? "—"}</td>
                <td className="py-1.5 pr-2 text-neutral-100">
                  {item.artist ? `${item.artist} — ${item.title}` : <span className="text-neutral-600">(unfilled)</span>}
                  {item.locked && <span className="ml-2 text-xs text-neutral-500">🔒</span>}
                </td>
                <td className="py-1.5 pr-2">
                  {violationSteps.length > 0 ? (
                    <span className="rounded bg-amber-900/60 px-1.5 py-0.5 text-xs text-amber-300" title={violationSteps.join(", ")}>
                      {violationSteps.length}
                    </span>
                  ) : (
                    <span className="text-neutral-700">—</span>
                  )}
                </td>
                <td className="py-1.5">
                  <div className="flex items-center gap-1.5" title={disabledTitle}>
                    <button
                      disabled={!item.editable}
                      onClick={() => setReplaceTarget({ itemId: item.id, categoryId: item.categoryId })}
                      className="rounded border border-neutral-700 px-1.5 py-0.5 text-xs hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-30"
                    >
                      Replace
                    </button>
                    <button
                      disabled={!item.editable}
                      onClick={() => toggleSwapSelect(item.id)}
                      className={`rounded border px-1.5 py-0.5 text-xs disabled:cursor-not-allowed disabled:opacity-30 ${
                        selected ? "border-purple-500 bg-purple-900/40" : "border-neutral-700 hover:bg-neutral-800"
                      }`}
                    >
                      {selected ? "Selected" : "Select for swap"}
                    </button>
                    <button
                      disabled={!item.editable && !item.locked}
                      onClick={() => handleLockToggle(item.id, item.locked)}
                      className="rounded border border-neutral-700 px-1.5 py-0.5 text-xs hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-30"
                    >
                      {item.locked ? "Unlock" : "Lock"}
                    </button>
                  </div>
                  {rowError?.id === item.id && <p className="text-xs text-red-400">{REASON_LABEL[rowError.message as EditRejectReason] ?? rowError.message}</p>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {replaceTarget && (
        <ReplaceModal
          logId={logId}
          itemId={replaceTarget.itemId}
          categoryId={replaceTarget.categoryId}
          onClose={() => setReplaceTarget(null)}
          onReplaced={() => {
            setReplaceTarget(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
