// The drift count for the sidebar badge (ADR-0002 §4.4).
import { findDrift } from "@rotavox/schema";
import { db } from "./db";

export async function getDriftCount(stationId: string): Promise<number> {
  return (await findDrift(db, stationId)).rows.length;
}
