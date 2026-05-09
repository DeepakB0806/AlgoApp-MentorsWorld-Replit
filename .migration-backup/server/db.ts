import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  min: 1,                      // always keep at least 1 live connection
  idleTimeoutMillis: 0,        // never close idle connections
  connectionTimeoutMillis: 30000,
});
export const db = drizzle(pool, { schema });
