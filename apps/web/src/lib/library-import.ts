// Reads an uploaded library file into a plan, for the preview and the import itself.
import {
  detectMapping,
  existingSongs,
  IMPORT_FIELDS,
  IMPORT_LIMITS,
  parseCsv,
  planImport,
  type ImportMapping,
  type ImportPlan,
} from "@rotavox/schema";
import { db } from "./db";

export class ImportRequestError extends Error {}

/** The body's CSV and column choices; a mapping the client sends overrides the detected one. */
export async function planFromRequest(stationId: string, body: Record<string, unknown>): Promise<ImportPlan> {
  const csv = typeof body.csv === "string" ? body.csv : "";
  if (!csv.trim()) throw new ImportRequestError("Choose a CSV file.");
  if (csv.length > IMPORT_LIMITS.bytes) throw new ImportRequestError("The file is over 10 MB. Split it and import the parts.");
  const rows = parseCsv(csv);
  if (rows.length === 0) throw new ImportRequestError("The file is empty.");
  let mapping: ImportMapping = detectMapping(rows[0]);
  if (body.mapping && typeof body.mapping === "object") {
    mapping = {};
    for (const f of IMPORT_FIELDS) {
      const v = (body.mapping as Record<string, unknown>)[f];
      if (Number.isInteger(v) && (v as number) >= 0 && (v as number) < rows[0].length) mapping[f] = v as number;
    }
  }
  return planImport(rows, mapping, await existingSongs(db, stationId));
}
