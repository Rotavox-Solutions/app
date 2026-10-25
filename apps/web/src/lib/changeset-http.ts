import { NextResponse } from "next/server";
import { ChangesetError, type ChangesetErrorCode } from "@rotavox/schema";

const STATUS: Record<ChangesetErrorCode, number> = {
  not_imported: 409,
  invalid: 400,
  not_found: 404,
  no_draft: 404,
  empty: 400,
  intent_required: 400,
  conflict: 409,
  draft_exists: 409,
  not_applied: 400,
  already_reverted: 409,
};

/** Runs a changeset operation, turning its refusals into JSON the client can show. */
export async function changesetResponse(op: () => Promise<unknown>): Promise<NextResponse> {
  try {
    return NextResponse.json((await op()) ?? { ok: true });
  } catch (err) {
    if (err instanceof ChangesetError) {
      return NextResponse.json(
        { error: err.code, message: err.message, conflicts: err.conflicts },
        { status: STATUS[err.code] }
      );
    }
    throw err;
  }
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    return body && typeof body === "object" ? body : {};
  } catch {
    return {};
  }
}
