// An unhandled 500 writes an `error` Log entry with source "app" (issue
// #67). This mirrors app.ts's own `onError` handler against a minimal
// Hono app, since provoking a genuine unhandled throw through the real
// routes (which all catch their own errors) isn't practical.

import { describe, expect, test } from "bun:test";
import { FakeClock } from "@ai-content-studio/shared";
import { Hono } from "hono";
import type { AppEnv } from "./auth/app-env.js";
import { createLogEntryWriter } from "./backends/log-entries.js";
import { logEntries } from "./db/schema.js";
import { createTestDatabase } from "./test/database.js";

function silentLogger() {
  return { debug() {}, info() {}, warn() {}, error() {} };
}

describe("an unhandled error", () => {
  test("is logged as an error with source app, and still answers 500", async () => {
    const testDb = await createTestDatabase("app_error_logging_test");
    try {
      const { db } = testDb;
      const clock = new FakeClock();
      const logWriter = createLogEntryWriter(db, clock, silentLogger());

      const app = new Hono<AppEnv>();
      app.use(async (c, next) => {
        c.set("logWriter", logWriter);
        c.set("session", null);
        return next();
      });
      app.onError(async (err, c) => {
        const session = c.get("session");
        await logWriter.log({
          level: "error",
          source: "app",
          message: err instanceof Error ? err.message : "unhandled error",
          details: err instanceof Error ? err.stack : undefined,
          userId: session?.user.id,
        });
        return c.json({ error: "internal error" }, 500);
      });
      app.get("/boom", () => {
        throw new Error("kaboom");
      });

      const res = await app.request("/boom");
      expect(res.status).toBe(500);

      const [row] = await db.select().from(logEntries);
      expect(row?.level).toBe("error");
      expect(row?.source).toBe("app");
      expect(row?.message).toBe("kaboom");
    } finally {
      await testDb.close();
    }
  });
});
