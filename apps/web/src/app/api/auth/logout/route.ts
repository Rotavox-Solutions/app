import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { endSession } from "@rotavox/schema";
import { db } from "@/lib/db";
import { clearSessionCookie, publicRoute, SESSION_COOKIE } from "@/lib/auth";

export const POST = publicRoute(async () => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (token) await endSession(db, token);
  await clearSessionCookie();
  return NextResponse.json({ ok: true });
});
