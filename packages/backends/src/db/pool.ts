import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

export function createPool(connectionString: string): postgres.Sql {
  return postgres(connectionString);
}

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "migrations");

export async function runMigrations(sql: postgres.Sql): Promise<void> {
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    const text = readFileSync(join(migrationsDir, file), "utf8");
    await sql.unsafe(text);
  }
}
