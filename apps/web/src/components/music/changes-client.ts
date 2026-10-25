// Client-side calls to the changeset API. Each returns an error message to show, or null.

export interface StageItem {
  songId: string;
  state: string;
  categoryId: string | null;
  reason?: string;
}

async function call(url: string, method: string, body?: unknown): Promise<string | null> {
  try {
    const res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.ok) return null;
    const data = await res.json().catch(() => ({}));
    return data.message ?? data.error ?? `Request failed (${res.status})`;
  } catch {
    return "Request failed — is the Cockpit reachable?";
  }
}

export const stage = (items: StageItem[]) => call("/api/changes", "POST", { items });
export const unstageSongs = (songIds: string[]) => call("/api/changes/items", "DELETE", { songIds });
export const saveIntent = (intent: string) => call("/api/changes/intent", "PUT", { intent });
export const discard = () => call("/api/changes", "DELETE");
export const revert = (changesetId: string) => call(`/api/changes/${changesetId}/revert`, "POST");

export interface ApplyConflict {
  songId: string;
  artist: string | null;
  title: string | null;
}

export async function applyDraft(intent: string): Promise<{ error: string | null; conflicts: ApplyConflict[] }> {
  try {
    const res = await fetch("/api/changes/apply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ intent }),
    });
    if (res.ok) return { error: null, conflicts: [] };
    const data = await res.json().catch(() => ({}));
    return { error: data.message ?? data.error ?? `Request failed (${res.status})`, conflicts: data.conflicts ?? [] };
  } catch {
    return { error: "Request failed — is the Cockpit reachable?", conflicts: [] };
  }
}
