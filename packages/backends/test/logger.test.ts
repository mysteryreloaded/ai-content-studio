import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import postgres from "postgres";
import { fakeClock } from "../src/clock";
import { runMigrations } from "../src/db/pool";
import { createLogger } from "../src/logger";

const CONNECTION_STRING = process.env.TEST_DATABASE_URL ?? "postgres://postgres:test@localhost:55432/backends_test";

let sql: postgres.Sql;

beforeAll(async () => {
  sql = postgres(CONNECTION_STRING);
  await runMigrations(sql);
});

afterAll(async () => {
  await sql.end();
});

beforeEach(async () => {
  await sql`truncate backends, log_entries, audit_entries restart identity cascade`;
});

describe("createLogger", () => {
  test("writes to Postgres with the injected clock's time", async () => {
    const clock = fakeClock(new Date("2026-05-01T00:00:00Z"));
    const logger = createLogger(sql, clock);

    await logger.log({ level: "warning", message: "Backend down" });

    const [row] = await sql`select * from log_entries`;
    expect(row.level).toBe("warning");
    expect(row.message).toBe("Backend down");
    expect(new Date(row.created_at).toISOString()).toBe("2026-05-01T00:00:00.000Z");
  });

  test("truncates details beyond 4000 characters", async () => {
    const clock = fakeClock();
    const logger = createLogger(sql, clock);
    const long = "x".repeat(5000);

    await logger.log({ level: "error", message: "oops", details: long });

    const [row] = await sql`select details from log_entries`;
    expect(row.details.length).toBe(4000);
  });
});
