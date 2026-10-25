// Client-side calls to the account API. Each resolves to { error } or the response data.

export async function send<T = Record<string, unknown>>(
  url: string,
  method: string,
  body?: unknown,
): Promise<{ error: string | null; data: T | null }> {
  try {
    const res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) return { error: null, data: data as T };
    return { error: data.message ?? data.error ?? `Request failed (${res.status})`, data: null };
  } catch {
    return { error: "Request failed. Is Rotavox reachable?", data: null };
  }
}

export const input =
  "w-full rounded border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-600 focus:border-neutral-500 focus:outline-none";
export const primaryButton =
  "rounded bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-600 disabled:opacity-50";
export const secondaryButton =
  "rounded border border-neutral-700 px-3 py-1 text-sm text-neutral-200 hover:bg-neutral-900 disabled:opacity-50";
export const label = "block space-y-1 text-sm text-neutral-300";
