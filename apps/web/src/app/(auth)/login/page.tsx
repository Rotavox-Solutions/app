import { redirect } from "next/navigation";
import { countUsers } from "@rotavox/schema";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { LoginForm } from "@/components/account/LoginForm";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  if (await getSession()) redirect("/today");

  if ((await countUsers(db)) === 0) {
    return (
      <div className="space-y-3 text-sm text-neutral-400">
        <h1 className="text-xl font-semibold text-neutral-100">No accounts yet</h1>
        <p>
          This is a new Rotavox install. Whoever installed it creates the first Rotavox staff account on the server,
          which makes a one-time link to open here. The steps are in DEPLOY.md, under &ldquo;The first account&rdquo;.
        </p>
        <p>Everyone else is invited from inside Rotavox after that.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Sign in</h1>
      <LoginForm next={next} />
      <p className="text-xs text-neutral-500">
        Forgotten your password? Ask Rotavox support for a reset link. New here? Ask your station admin for an invitation.
      </p>
    </div>
  );
}
