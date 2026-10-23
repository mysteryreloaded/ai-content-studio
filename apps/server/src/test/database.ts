import postgres from "postgres";
import { type Database, createDatabase } from "../db/client.js";
import { DEFAULT_MIGRATIONS_FOLDER, migrateWithLock } from "../db/migrate.js";

const BASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgres://postgres:postgres@localhost:15432/postgres";
const TEMPLATE_NAME = "ai_content_studio_test_template";

function urlWithDatabase(databaseName: string): string {
  const url = new URL(BASE_URL);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

let templateReady: Promise<void> | undefined;

/** Migrates the shared template database once per test run. */
function ensureTemplateMigrated(): Promise<void> {
  if (!templateReady) {
    templateReady = (async () => {
      const admin = postgres(urlWithDatabase("postgres"), { max: 1 });
      try {
        await admin.unsafe(`DROP DATABASE IF EXISTS ${TEMPLATE_NAME}`);
        await admin.unsafe(`CREATE DATABASE ${TEMPLATE_NAME}`);
      } finally {
        await admin.end();
      }
      await migrateWithLock(
        urlWithDatabase(TEMPLATE_NAME),
        DEFAULT_MIGRATIONS_FOLDER,
      );
    })();
  }
  return templateReady;
}

export interface TestDatabase {
  db: Database;
  sql: postgres.Sql;
  close(): Promise<void>;
}

/**
 * A fresh database, copied from the once-per-run migrated template, for
 * one test file. Test files must run sequentially (see bunfig.toml) so
 * each gets its own database name without clashing.
 */
export async function createTestDatabase(name: string): Promise<TestDatabase> {
  await ensureTemplateMigrated();

  const admin = postgres(urlWithDatabase("postgres"), { max: 1 });
  try {
    await admin.unsafe(`DROP DATABASE IF EXISTS ${name}`);
    await admin.unsafe(`CREATE DATABASE ${name} TEMPLATE ${TEMPLATE_NAME}`);
  } finally {
    await admin.end();
  }

  const { sql, db } = createDatabase(urlWithDatabase(name));
  return {
    db,
    sql,
    close: async () => {
      await sql.end();
      const cleanup = postgres(urlWithDatabase("postgres"), { max: 1 });
      try {
        await cleanup.unsafe(`DROP DATABASE IF EXISTS ${name}`);
      } finally {
        await cleanup.end();
      }
    },
  };
}
