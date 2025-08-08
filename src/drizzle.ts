import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

function getDirectConnectionString(): string {
  const direct = process.env.SUPABASE_DB_DIRECT_URL;
  if (direct && direct.length > 0) return direct;

  const fallback = process.env.SUPABASE_DB_CONNECTION_STRING!;
  try {
    const url = new URL(fallback);
    // Remove pgBouncer-specific params if present
    url.searchParams.delete("pgbouncer");
    return url.toString();
  } catch {
    return fallback;
  }
}

const connectionString = getDirectConnectionString();

// Postgres.js client for Drizzle
const client = postgres(connectionString, {
  max: 1,
  idle_timeout: 5,
  prepare: false,
  ssl: "require",
});

export const db = drizzle(client);
