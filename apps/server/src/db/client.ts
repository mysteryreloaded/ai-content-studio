import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

export type Database = ReturnType<typeof drizzle<typeof schema>>;

/** The transaction object `Database#transaction`'s callback receives. */
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export function createDatabase(databaseUrl: string): {
  sql: postgres.Sql;
  db: Database;
} {
  const sql = postgres(databaseUrl);
  const db = drizzle(sql, { schema });
  return { sql, db };
}
