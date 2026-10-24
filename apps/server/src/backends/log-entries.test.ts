import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { FakeClock } from "@ai-content-studio/shared";
import { logEntries } from "../db/schema.js";
import type { Logger } from "../logger.js";
import { createTestDatabase } from "../test/database.js";
import { createLogEntryWriter } from "./log-entries.js";

function silentLogger(): Logger {
  return { debug() {}, info() {}, warn() {}, error() {} };
}

describe("createLogEntryWriter", () => {
  const testDb = createTestDatabase("log_entries_test");

  afterAll(async () => {
    await (await testDb).close();
  });

  beforeEach(async () => {
    const { db } = await testDb;
    await db.delete(logEntries);
  });

  test("writes to Postgres with the injected clock's time", async () => {
    const { db } = await testDb;
    const clock = new FakeClock(new Date("2026-05-01T00:00:00Z"));
    const writer = createLogEntryWriter(db, clock, silentLogger());

    await writer.log({ level: "warning", message: "Backend down" });

    const [row] = await db.select().from(logEntries);
    expect(row?.level).toBe("warning");
    expect(row?.message).toBe("Backend down");
    expect(row?.createdAt.toISOString()).toBe("2026-05-01T00:00:00.000Z");
  });

  test("truncates details beyond 4000 characters", async () => {
    const { db } = await testDb;
    const clock = new FakeClock();
    const writer = createLogEntryWriter(db, clock, silentLogger());
    const long = "x".repeat(5000);

    await writer.log({ level: "error", message: "oops", details: long });

    const [row] = await db.select().from(logEntries);
    expect(row?.details?.length).toBe(4000);
  });

  test("also writes a line via the stdout Logger", async () => {
    const { db } = await testDb;
    const clock = new FakeClock();
    const lines: string[] = [];
    const logger: Logger = {
      debug() {},
      info(msg) {
        lines.push(msg);
      },
      warn(msg) {
        lines.push(msg);
      },
      error(msg) {
        lines.push(msg);
      },
    };
    const writer = createLogEntryWriter(db, clock, logger);

    await writer.log({ level: "info", message: "Backend recovered" });

    expect(lines).toContain("Backend recovered");
  });
});
