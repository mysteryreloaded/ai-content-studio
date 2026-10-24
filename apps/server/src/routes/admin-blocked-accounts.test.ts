// `/api/admin/blocked-accounts`: list and clear (issue #64).

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { FakeClock } from "@ai-content-studio/shared";
import { eq } from "drizzle-orm";
import { createApp } from "../app.js";
import { SESSION_COOKIE_NAME, createSession } from "../auth/session.js";
import { auditEntries, blockedAccounts, users } from "../db/schema.js";
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
  ADMIN_EMAILS: [],
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

describe("/api/admin/blocked-accounts", () => {
  const testDb = createTestDatabase("admin_blocked_accounts_route_test");
  const clock = new FakeClock();

  afterAll(async () => {
    await (await testDb).close();
  });

  beforeEach(async () => {
    const { db } = await testDb;
    await db.delete(blockedAccounts);
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

  async function adminCookie(): Promise<string> {
    const { db } = await testDb;
    const [admin] = await db
      .insert(users)
      .values({
        googleSub: "sub-admin",
        email: "admin@example.com",
        name: "Admin",
        role: "admin",
        status: "active",
      })
      .returning();
    if (!admin) throw new Error("failed to insert admin");
    const session = await createSession(db, clock, admin.id);
    return `${SESSION_COOKIE_NAME}=${session.cookieValue}`;
  }

  /** A scrubbed "Deleted user" row, the kind a blocked account's `userId` points at. */
  async function deletedUser() {
    const { db } = await testDb;
    const [user] = await db
      .insert(users)
      .values({
        googleSub: crypto.randomUUID(),
        email: "",
        name: "Deleted user",
        role: "user",
        status: "disabled",
        deletedAt: clock.now(),
      })
      .returning();
    if (!user) throw new Error("failed to insert deleted user");
    return user;
  }

  test("lists blocked accounts newest first", async () => {
    const { app, db } = await build();
    const cookie = await adminCookie();
    const first = await deletedUser();
    const second = await deletedUser();

    clock.advance(1000);
    await db.insert(blockedAccounts).values({
      subHash: "hash-1",
      userId: first.id,
      reason: "First",
      createdAt: clock.now(),
    });
    clock.advance(1000);
    await db.insert(blockedAccounts).values({
      subHash: "hash-2",
      userId: second.id,
      reason: "Second",
      createdAt: clock.now(),
    });

    const res = await app.request("/api/admin/blocked-accounts", {
      headers: { ...SAME_ORIGIN_HEADERS, Cookie: cookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      blockedAccounts: { reason: string }[];
    };
    expect(body.blockedAccounts.map((b) => b.reason)).toEqual([
      "Second",
      "First",
    ]);
  });

  test("DELETE clears an entry and records an Audit entry", async () => {
    const { app, db } = await build();
    const cookie = await adminCookie();
    const user = await deletedUser();

    const [row] = await db
      .insert(blockedAccounts)
      .values({ subHash: "hash-1", userId: user.id, reason: "Spam" })
      .returning();
    if (!row) throw new Error("failed to insert blocked account");

    const res = await app.request(`/api/admin/blocked-accounts/${row.id}`, {
      method: "DELETE",
      headers: { ...SAME_ORIGIN_HEADERS, Cookie: cookie },
    });
    expect(res.status).toBe(200);

    const remaining = await db
      .select()
      .from(blockedAccounts)
      .where(eq(blockedAccounts.id, row.id));
    expect(remaining).toEqual([]);

    const [entry] = await db
      .select()
      .from(auditEntries)
      .where(eq(auditEntries.targetId, row.id));
    expect(entry?.action).toBe("unblock");
    expect(entry?.before).toEqual({ reason: "Spam" });
  });

  test("DELETE 404s for a missing entry", async () => {
    const { app } = await build();
    const cookie = await adminCookie();

    const res = await app.request(
      "/api/admin/blocked-accounts/00000000-0000-0000-0000-000000000000",
      { method: "DELETE", headers: { ...SAME_ORIGIN_HEADERS, Cookie: cookie } },
    );
    expect(res.status).toBe(404);
  });
});
