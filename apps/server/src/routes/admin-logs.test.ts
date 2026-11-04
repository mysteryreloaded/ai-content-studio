// `/api/admin/logs`: filters, text search, the 24h error badge, and the
// warning Log entry a non-Admin calling an admin route leaves (issue #67).

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { FakeClock } from "@ai-content-studio/shared";
import { createApp } from "../app.js";
import { SESSION_COOKIE_NAME, createSession } from "../auth/session.js";
import { logEntries, users } from "../db/schema.js";
import type { Env } from "../env.js";
import type { Logger } from "../logger.js";
import { createTestDatabase } from "../test/database.js";

const silentLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

const TEST_ENV: Env = {
  DATABASE_URL: "unused",
  PORT: 3000,
  LOG_LEVEL: "error",
  PUBLIC_URL: "http://localhost:3000",
  GOOGLE_CLIENT_ID: "test-client",
  GOOGLE_CLIENT_SECRET: "test-secret",
  ADMIN_EMAILS: ["admin@example.com"],
  OIDC_ISSUER: undefined,
  DATA_DIR: "/tmp/ai-content-studio-test-data",
  SECRET_KEY: "4FRG13w9RuN5CeV10Lzfxl78MY+AJRJtGuKrBdYzgCY=",
  BACKENDS_ENABLED: false,
  STATUS_TOKEN: undefined,
  MIN_FREE_DISK_GB: 10,
  MAX_UPLOAD_MB: 500,
  FFMPEG_CONCURRENCY: 2,
  LOG_RETENTION_DAYS: 30,
};

const SAME_ORIGIN_HEADERS = { "Sec-Fetch-Site": "same-origin" };

describe("GET /api/admin/logs", () => {
  const testDb = createTestDatabase("admin_logs_route_test");
  const clock = new FakeClock();

  afterAll(async () => {
    await (await testDb).close();
  });

  beforeEach(async () => {
    const { db } = await testDb;
    await db.delete(logEntries);
    await db.delete(users);
  });

  async function build() {
    const { db, sql } = await testDb;
    const { app } = await createApp({
      db,
      sql,
      clock,
      logger: silentLogger,
      env: TEST_ENV,
      webDistDir: new URL("../../../web", import.meta.url).pathname,
    });
    return { app, db };
  }

  async function makeUser(role: "user" | "admin", email: string) {
    const { db } = await testDb;
    const [user] = await db
      .insert(users)
      .values({ googleSub: `sub-${email}`, email, name: email, role })
      .returning();
    if (!user) throw new Error("failed to insert test user");
    return user;
  }

  async function cookieFor(userId: string): Promise<string> {
    const { db } = await testDb;
    const session = await createSession(db, clock, userId);
    return `${SESSION_COOKIE_NAME}=${session.cookieValue}`;
  }

  test("filters by level, source and text", async () => {
    const { app, db } = await build();
    const admin = await makeUser("admin", "admin@example.com");

    await db.insert(logEntries).values([
      {
        level: "error",
        source: "backend",
        message: "Backend unreachable",
        createdAt: clock.now(),
      },
      {
        level: "info",
        source: "app",
        message: "all good",
        createdAt: clock.now(),
      },
    ]);

    const res = await app.request("/api/admin/logs?level=error", {
      headers: { ...SAME_ORIGIN_HEADERS, Cookie: await cookieFor(admin.id) },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { entries: { message: string }[] };
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0]?.message).toBe("Backend unreachable");

    const textRes = await app.request("/api/admin/logs?q=good", {
      headers: { ...SAME_ORIGIN_HEADERS, Cookie: await cookieFor(admin.id) },
    });
    const textBody = (await textRes.json()) as {
      entries: { message: string }[];
    };
    expect(textBody.entries).toHaveLength(1);
    expect(textBody.entries[0]?.message).toBe("all good");
  });

  test("joins the user's email for display", async () => {
    const { app, db } = await build();
    const admin = await makeUser("admin", "admin@example.com");
    const other = await makeUser("user", "other@example.com");

    await db.insert(logEntries).values({
      level: "warning",
      source: "app",
      message: "non-Admin called an admin route",
      userId: other.id,
      createdAt: clock.now(),
    });

    const res = await app.request("/api/admin/logs", {
      headers: { ...SAME_ORIGIN_HEADERS, Cookie: await cookieFor(admin.id) },
    });
    const body = (await res.json()) as {
      entries: { userEmail: string | null }[];
    };
    expect(body.entries[0]?.userEmail).toBe("other@example.com");
  });

  test("a non-Admin calling an admin route leaves a warning Log entry", async () => {
    const { app, db } = await build();
    await makeUser("admin", "admin@example.com");
    const nonAdmin = await makeUser("user", "regular@example.com");

    const res = await app.request("/api/admin/backends", {
      headers: {
        ...SAME_ORIGIN_HEADERS,
        Cookie: await cookieFor(nonAdmin.id),
      },
    });
    expect(res.status).toBe(403);

    const rows = await db.select().from(logEntries);
    const warning = rows.find((r) => r.level === "warning");
    expect(warning?.source).toBe("app");
    expect(warning?.userId).toBe(nonAdmin.id);
    expect(warning?.message).toContain("GET /api/admin/backends");
  });

  test("filters by request id, as an Audit entry's link would set it", async () => {
    const { app, db } = await build();
    const admin = await makeUser("admin", "admin@example.com");

    const now = clock.now();
    await db.insert(logEntries).values([
      {
        level: "error",
        source: "app",
        message: "written in request A",
        requestId: "00000000-0000-0000-0000-0000000000aa",
        createdAt: now,
      },
      {
        level: "error",
        source: "app",
        message: "written in request B",
        requestId: "00000000-0000-0000-0000-0000000000bb",
        createdAt: now,
      },
      {
        level: "error",
        source: "app",
        message: "outside any request",
        createdAt: now,
      },
    ]);

    const res = await app.request(
      "/api/admin/logs?requestId=00000000-0000-0000-0000-0000000000aa",
      {
        headers: { ...SAME_ORIGIN_HEADERS, Cookie: await cookieFor(admin.id) },
      },
    );
    const body = (await res.json()) as {
      entries: { message: string; requestId: string | null }[];
    };
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0]?.message).toBe("written in request A");
    expect(body.entries[0]?.requestId).toBe(
      "00000000-0000-0000-0000-0000000000aa",
    );
  });

  test("keyset paging walks entries that share a createdAt, without gaps or repeats", async () => {
    const { app, db } = await build();
    const admin = await makeUser("admin", "admin@example.com");

    // Five entries share one timestamp: their order within that second
    // must come from the id tie-break (desc(createdAt), desc(id)).
    const now = clock.now();
    for (let i = 0; i < 5; i++) {
      await db.insert(logEntries).values({
        level: "error",
        source: "app",
        message: `entry-${i}`,
        createdAt: now,
      });
    }

    const cookie = await cookieFor(admin.id);
    const seen: string[] = [];
    let cursor = "";
    for (let page = 0; page < 3; page++) {
      const res = await app.request(`/api/admin/logs?limit=2${cursor}`, {
        headers: { ...SAME_ORIGIN_HEADERS, Cookie: cookie },
      });
      const body = (await res.json()) as {
        entries: { id: string; createdAt: string }[];
        hasMore: boolean;
      };
      for (const entry of body.entries) {
        expect(seen).not.toContain(entry.id);
        seen.push(entry.id);
      }
      if (!body.hasMore) break;
      const last = body.entries[body.entries.length - 1];
      if (!last) throw new Error("the cursor page was empty");
      cursor = `&beforeCreatedAt=${encodeURIComponent(last.createdAt)}&beforeId=${last.id}`;
    }
    expect(seen).toHaveLength(5);
  });

  test("a 500 inside a request leaves a Log entry carrying that request's id", async () => {
    const { db, sql } = await testDb;
    // A `webDistDir` without its `index.html` makes the SPA fallback's
    // `Bun.file(...).text()` throw: the cleanest unhandled error this app
    // can answer, so the real `onError` writes the entry.
    const { app } = await createApp({
      db,
      sql,
      clock,
      logger: silentLogger,
      env: TEST_ENV,
      webDistDir: "/nonexistent-web-dist",
    });

    const res = await app.request("/");
    expect(res.status).toBe(500);
    const requestId = res.headers.get("x-request-id");
    expect(requestId).not.toBeNull();

    const entry = (await db.select().from(logEntries)).find(
      (row) => row.level === "error",
    );
    expect(entry?.source).toBe("app");
    expect(entry?.message).toContain("ENOENT");
    expect(entry?.requestId).toBe(requestId);
  });

  test("error-count-24h counts only errors within the last 24 hours", async () => {
    const { app, db } = await build();
    const admin = await makeUser("admin", "admin@example.com");

    await db.insert(logEntries).values([
      {
        level: "error",
        source: "app",
        message: "recent",
        createdAt: clock.now(),
      },
      {
        level: "error",
        source: "app",
        message: "stale",
        createdAt: new Date(clock.now().getTime() - 25 * 60 * 60 * 1000),
      },
      {
        level: "warning",
        source: "app",
        message: "not an error",
        createdAt: clock.now(),
      },
    ]);

    const res = await app.request("/api/admin/logs/error-count-24h", {
      headers: { ...SAME_ORIGIN_HEADERS, Cookie: await cookieFor(admin.id) },
    });
    const body = (await res.json()) as { count: number };
    expect(body.count).toBe(1);
  });
});
