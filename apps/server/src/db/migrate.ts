import path from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

/**
 * A fixed, arbitrary advisory lock key for this app's own migrations.
 * Reuses the single-instance-coordination pattern of ADR 0002's
 * dispatcher lock so a second booting instance waits instead of racing.
 */
const MIGRATION_LOCK_KEY = 72_738_291;

export const DEFAULT_MIGRATIONS_FOLDER = path.join(
  import.meta.dir,
  "..",
  "..",
  "drizzle",
  "migrations",
);

/** Applies committed migrations at boot, serialised across instances by an advisory lock. */
export async function migrateWithLock(
  databaseUrl: string,
  migrationsFolder: string = DEFAULT_MIGRATIONS_FOLDER,
): Promise<void> {
  // A single-connection pool: Postgres advisory locks are per-session, so
  // the lock, the migration and the unlock must share one connection.
  const sql = postgres(databaseUrl, { max: 1 });
  try {
    await sql`select pg_advisory_lock(${MIGRATION_LOCK_KEY})`;
    try {
      await migrate(drizzle(sql), { migrationsFolder });
    } finally {
      await sql`select pg_advisory_unlock(${MIGRATION_LOCK_KEY})`;
    }
  } finally {
    await sql.end();
  }
}
