import "dotenv/config";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema.js";
import { PG_CONNECTION_OPTIONS } from "./connection.js";
import { createInvite, INVITE_DAYS } from "./accounts.js";

// The one account that can't be made in the UI: the first Rotavox staff member, on a
// fresh install. Prints a one-time link; whoever opens it sets their own name and
// password, so no password is ever typed on the command line. Staff then invite
// everyone else, including more staff, from the app.
//
//   npm run invite-staff -w @rotavox/schema -- you@rotavox.com
//
// APP_URL sets the link's address (default http://localhost:3000).
const email = process.argv[2];
if (!email) {
  console.error("Usage: npm run invite-staff -w @rotavox/schema -- <email>");
  process.exit(1);
}
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("Missing required env var DATABASE_URL (see packages/schema/.env.example)");

const client = postgres(databaseUrl, { max: 1, ...PG_CONNECTION_OPTIONS });
try {
  const db = drizzle(client, { schema });
  const { token } = await createInvite(db, { email, stationId: null, role: null, isStaff: true, createdBy: null });
  const base = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  console.log(`Staff invitation for ${email}, valid ${INVITE_DAYS} days. Open it to set a name and password:\n`);
  console.log(`  ${base}/invite/${token}\n`);
  console.log("It works once. Anyone with the link can claim the account, so send it privately.");
} finally {
  await client.end();
}
