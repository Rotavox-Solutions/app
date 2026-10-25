// Request glue for accounts (ADR-0003): the session cookie, the page guards and the API
// route wrapper. The rules themselves live in @rotavox/schema's accounts.ts.
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { AccountError, can, resolveSession, type Permission, type SessionContext } from "@rotavox/schema";
import { db } from "./db";

export const SESSION_COOKIE = "rotavox_session";

export interface StationContext extends SessionContext {
  station: NonNullable<SessionContext["station"]>;
  stationId: string;
}

/** The signed-in person for this request, or null. Cached, so a page and its layout share one lookup. */
export const getSession = cache(async (): Promise<SessionContext | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return token ? resolveSession(db, token) : null;
});

// ── Pages ───────────────────────────────────────────────────────────────────────────

export async function requireSession(): Promise<SessionContext> {
  const ctx = await getSession();
  if (!ctx) redirect("/login");
  return ctx;
}

/**
 * For every page that shows a station's data. Someone with no station yet goes to the
 * station picker; a page that needs more than viewing checks `can` itself and says why
 * rather than bouncing.
 */
export async function requireStation(): Promise<StationContext> {
  const ctx = await requireSession();
  if (!ctx.station) redirect("/stations");
  return { ...ctx, station: ctx.station, stationId: ctx.station.id };
}

export const allowed = (ctx: SessionContext, permission: Permission) =>
  can({ isStaff: ctx.user.isStaff, role: ctx.role }, permission);

// ── API routes ──────────────────────────────────────────────────────────────────────

const json = (status: number, error: string, message: string) => NextResponse.json({ error, message }, { status });

/**
 * A state-changing request must come from this app's own pages. SameSite=Lax already keeps
 * the cookie off cross-site POSTs; this also refuses a cross-origin request that carries
 * no cookie at all, such as a forged sign-in.
 */
export function sameOrigin(request: Request): boolean {
  if (request.method === "GET" || request.method === "HEAD") return true;
  const origin = request.headers.get("origin");
  if (!origin) return true; // not a browser: no ambient credentials to abuse
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

type Segment<P> = { params: Promise<P> };

/** An AccountError becomes JSON the client can show; anything else is a real fault. */
export async function accountResponse(op: () => Promise<unknown>): Promise<NextResponse> {
  try {
    return NextResponse.json((await op()) ?? { ok: true });
  } catch (err) {
    if (err instanceof AccountError) {
      const status = {
        bad_credentials: 401,
        locked: 429,
        forbidden: 403,
        not_found: 404,
        email_taken: 409,
        last_admin: 409,
      }[err.code as string];
      return json(status ?? 400, err.code, err.message);
    }
    throw err;
  }
}

/** A route that needs no account: signing in, and using an invitation or reset link. */
export function publicRoute<P = Record<string, never>>(handler: (request: Request, params: P) => Promise<Response>) {
  return async (request: Request, segment: Segment<P>) => {
    if (!sameOrigin(request)) return json(403, "cross_origin", "Refused: this request didn't come from Rotavox.");
    return handler(request, await segment.params);
  };
}

/** A route about the signed-in person themselves, not a station: their account, their sessions. */
export function userRoute<P = Record<string, never>>(
  handler: (request: Request, ctx: SessionContext, params: P) => Promise<Response>,
  opts: { staff?: boolean } = {},
) {
  return async (request: Request, segment: Segment<P>) => {
    if (!sameOrigin(request)) return json(403, "cross_origin", "Refused: this request didn't come from Rotavox.");
    const ctx = await getSession();
    if (!ctx) return json(401, "signed_out", "You've been signed out. Sign in again.");
    if (opts.staff && !ctx.user.isStaff) return json(403, "forbidden", "Only Rotavox staff can do that.");
    return handler(request, ctx, await segment.params);
  };
}

/**
 * Every route that reads or changes a station's data goes through this. The station is
 * the one the session is working on — never one named in the request — so a URL with
 * another station's ids finds nothing.
 */
export function stationRoute<P = Record<string, never>>(
  permission: Permission,
  handler: (request: Request, ctx: StationContext, params: P) => Promise<Response>,
) {
  return async (request: Request, segment: Segment<P>) => {
    if (!sameOrigin(request)) return json(403, "cross_origin", "Refused: this request didn't come from Rotavox.");
    const ctx = await getSession();
    if (!ctx) return json(401, "signed_out", "You've been signed out. Sign in again.");
    if (!ctx.station) return json(409, "no_station", "Pick a station first.");
    if (!allowed(ctx, permission)) return json(403, "forbidden", "Your role at this station doesn't allow that.");
    return handler(request, { ...ctx, station: ctx.station, stationId: ctx.station.id }, await segment.params);
  };
}

export async function setSessionCookie(request: Request, token: string, expires: Date): Promise<void> {
  const proto = request.headers.get("x-forwarded-proto") ?? new URL(request.url).protocol.replace(":", "");
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: proto === "https",
    path: "/",
    expires,
  });
}

export async function clearSessionCookie(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}

/** Where an invitation or reset link points, for showing to the admin who made it. */
export function linkFor(request: Request, path: string): string {
  const proto = request.headers.get("x-forwarded-proto") ?? new URL(request.url).protocol.replace(":", "");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? new URL(request.url).host;
  return `${process.env.APP_URL?.replace(/\/$/, "") ?? `${proto}://${host}`}${path}`;
}
