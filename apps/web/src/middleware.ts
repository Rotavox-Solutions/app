import { NextResponse, type NextRequest } from "next/server";

// A cheap first gate: no session cookie, no app. Whether the cookie is any good is
// checked against the database by the page or route itself (lib/auth.ts); this only
// spares a signed-out visitor a broken page.
// The Runner API authenticates with a Runner key, checked in its route.
const PUBLIC = [/^\/login$/, /^\/invite\//, /^\/reset\//, /^\/api\/auth\//, /^\/api\/runner\/v1\//];

export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (PUBLIC.some((p) => p.test(pathname)) || request.cookies.has("rotavox_session")) return NextResponse.next();
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "signed_out", message: "Sign in first." }, { status: 401 });
  }
  const login = new URL("/login", publicOrigin(request));
  if (pathname !== "/") login.searchParams.set("next", pathname + search);
  return NextResponse.redirect(login);
}

// request.url carries the address `next start` is bound to (127.0.0.1:3000), not the one
// the visitor used, so behind a proxy (the Cloudflare Tunnel) a redirect built from it
// points at localhost. Same resolution as linkFor in lib/auth.ts, which middleware can't
// import (edge runtime).
function publicOrigin(request: NextRequest): string {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  const proto = request.headers.get("x-forwarded-proto") ?? request.nextUrl.protocol.replace(":", "");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? request.nextUrl.host;
  return `${proto}://${host}`;
}

export const config = {
  matcher: ["/((?!_next/|favicon.ico).*)"],
};
