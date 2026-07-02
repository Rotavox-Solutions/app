import "dotenv/config";
import mysql from "mysql2/promise";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var ${name} (see apps/runner/.env.example)`);
  }
  return value;
}

export const pool = mysql.createPool({
  host: requireEnv("RADIODJ_DB_HOST"),
  port: Number(process.env.RADIODJ_DB_PORT ?? 3306),
  user: requireEnv("RADIODJ_DB_USER"),
  password: requireEnv("RADIODJ_DB_PASSWORD"),
  database: requireEnv("RADIODJ_DB_NAME"),
  connectionLimit: 5,
});
