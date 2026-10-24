import path from "node:path";
import { systemClock } from "@ai-content-studio/shared";
import { createApp } from "./app.js";
import { createDatabase } from "./db/client.js";
import { migrateWithLock } from "./db/migrate.js";
import { EnvValidationError, loadEnv } from "./env.js";
import { createLogger } from "./logger.js";

async function main() {
  let env: ReturnType<typeof loadEnv>;
  try {
    env = loadEnv();
  } catch (error) {
    if (error instanceof EnvValidationError) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }

  const logger = createLogger(systemClock, env.LOG_LEVEL);

  logger.info("running migrations");
  await migrateWithLock(env.DATABASE_URL);

  const { sql, db } = createDatabase(env.DATABASE_URL);
  const webDistDir = path.join(import.meta.dir, "..", "..", "web", "dist");

  const { app } = await createApp({
    db,
    sql,
    clock: systemClock,
    logger,
    env,
    webDistDir,
  });

  logger.info("server listening", { port: env.PORT });
  Bun.serve({ port: env.PORT, fetch: app.fetch });
}

main();
