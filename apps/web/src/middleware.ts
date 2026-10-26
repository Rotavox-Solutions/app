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
  const login = new URL("/login", request.url);
  if (pathname !== "/") login.searchParams.set("next", pathname + search);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/((?!_next/|favicon.ico).*)"],
};
