import { MIN_PASSWORD_LENGTH, previewToken, ROLE_LABEL } from "@rotavox/schema";
import { db } from "@/lib/db";
import { TokenForm } from "@/components/account/TokenForm";

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invite = await previewToken(db, token);
  if (!invite || invite.purpose !== "invite") {
    return (
      <div className="space-y-3 text-sm text-neutral-400">
        <h1 className="text-xl font-semibold text-neutral-100">This invitation can&apos;t be used</h1>
        <p>It has already been used, was withdrawn, or has expired. Ask whoever sent it for a new one.</p>
      </div>
    );
  }
  const what = invite.isStaff
    ? "Rotavox staff"
    : `${invite.stationName ?? "a station"} as ${invite.role ? ROLE_LABEL[invite.role] : "a member"}`;

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-xl font-semibold">You&apos;re invited to {what}</h1>
        <p className="text-sm text-neutral-400">
          {invite.invitedBy ? `${invite.invitedBy} invited ` : "This invitation is for "}
          <span className="text-neutral-200">{invite.email}</span>.
          {invite.accountExists
            ? " You already have a Rotavox account, so enter its password to accept."
            : " Choose your name and a password to finish setting up your account."}
        </p>
      </div>
      <TokenForm
        url={`/api/auth/invite/${token}`}
        mode={invite.accountExists ? "existing_account" : "new_account"}
        email={invite.email}
        minLength={MIN_PASSWORD_LENGTH}
      />
    </div>
  );
}
