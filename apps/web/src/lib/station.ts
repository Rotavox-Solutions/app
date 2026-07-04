function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var ${name} (see apps/web/.env.example)`);
  }
  return value;
}

// No auth this milestone (spec §1: "not a multi-station product yet") — resolved
// the same way apps/runner resolves it, from an env var, not request/session state.
export const stationId = requireEnv("SCHEDULER_STATION_ID");
