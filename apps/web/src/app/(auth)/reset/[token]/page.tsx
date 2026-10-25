import { MIN_PASSWORD_LENGTH, previewToken } from "@rotavox/schema";
import { db } from "@/lib/db";
import { TokenForm } from "@/components/account/TokenForm";

export default async function ResetPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const reset = await previewToken(db, token);
  if (!reset || reset.purpose !== "reset") {
    return (
      <div className="space-y-3 text-sm text-neutral-400">
        <h1 className="text-xl font-semibold text-neutral-100">This link can&apos;t be used</h1>
        <p>It has already been used or has expired. Ask Rotavox support for a new one.</p>
      </div>
    );
  }
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-xl font-semibold">Set a new password</h1>
        <p className="text-sm text-neutral-400">
          For <span className="text-neutral-200">{reset.email}</span>. Every browser signed in to this account will be
          signed out.
        </p>
      </div>
      <TokenForm url={`/api/auth/reset/${token}`} mode="reset" email={reset.email} minLength={MIN_PASSWORD_LENGTH} />
    </div>
  );
}
