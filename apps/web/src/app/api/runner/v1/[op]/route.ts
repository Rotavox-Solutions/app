import { NextResponse } from "next/server";
import { isRunnerOp, RunnerOpError, runRunnerOp } from "@rotavox/schema";
import { db } from "@/lib/db";
import { runnerRoute } from "@/lib/auth";

/**
 * The Runner API: one POST per operation, body and response in the Runner wire format
 * (JSON with ISO dates). The operations and their station checks are in
 * @rotavox/schema's runner-ops.ts; this only authenticates and transports.
 */
export const POST = runnerRoute<{ op: string }>(async (request, { stationId }, { op }) => {
  if (!isRunnerOp(op))
    return NextResponse.json({ error: "unknown_op", message: `No Runner operation "${op}".` }, { status: 404 });
  try {
    const body = await runRunnerOp(db, stationId, op, await request.text());
    return new NextResponse(body, { headers: { "content-type": "application/json" } });
  } catch (err) {
    if (err instanceof RunnerOpError) {
      return NextResponse.json({ error: "rejected", message: err.message }, { status: err.status });
    }
    if (err instanceof SyntaxError) {
      return NextResponse.json({ error: "bad_request", message: "The body isn't valid JSON." }, { status: 400 });
    }
    console.error(`[runner-api] ${op} failed:`, err);
    return NextResponse.json({ error: "server_error", message: (err as Error).message }, { status: 500 });
  }
});
