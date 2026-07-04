import { NextResponse } from "next/server";
import { approveLog, EditRejectedError } from "@/lib/log-edits";

export async function POST(_request: Request, { params }: { params: Promise<{ logId: string }> }) {
  const { logId } = await params;
  try {
    const result = await approveLog(logId);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof EditRejectedError) {
      return NextResponse.json({ error: err.reason }, { status: err.reason === "not_found" ? 404 : 400 });
    }
    throw err;
  }
}
