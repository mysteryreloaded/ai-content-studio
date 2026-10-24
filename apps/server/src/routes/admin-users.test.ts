// `/api/admin/users`: list/search/filter, pending-count, and
// approve/promote/demote (issue #62, ADR 0008).

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { FakeClock } from "@ai-content-studio/shared";
import { eq } from "drizzle-orm";
import { createApp } from "../app.js";
import { SESSION_COOKIE_NAME, createSession } from "../auth/session.js";
import { isAccountBlocked } from "../auth/users.js";
import {
  auditEntries,
  blockedAccounts,
  sessions,
  users,
} from "../db/schema.js";
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
  ADMIN_EMAILS: ["pinned-admin@example.com"],
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

describe("/api/admin/users", () => {
  const testDb = createTestDatabase("admin_users_route_test");
  const clock = new FakeClock();

  afterAll(async () => {
    await (await testDb).close();
  });

  // Audit entries are append-only (a DB trigger refuses DELETE), so only
  // `users` is cleared here; each test's own random user ids keep its
  // Audit assertions from seeing another test's rows.
  beforeEach(async () => {
    const { db } = await testDb;
    await db.delete(blockedAccounts);
    await db.delete(users);
  });

  async function build(env: Env = TEST_ENV) {
    const { db, sql } = await testDb;
    const { app } = await createApp({
      db,
      sql,
      clock,
      logger: silentLogger,
      env,
      webDistDir: new URL("../../../web", import.meta.url).pathname,
    });
    return { app, db };
  }

  async function makeUser(
    overrides: Partial<typeof users.$inferInsert> & { email: string },
  ) {
    const { db } = await testDb;
    // Each call gets a later `createdAt` than the last (ADR 0006: time is
    // injected), so "newest first" ordering never depends on wall-clock
    // timing between two fast inserts.
    clock.advance(1000);
    const [user] = await db
      .insert(users)
      .values({
        googleSub: `sub-${overrides.email}`,
        name: overrides.email,
        role: "user",
        status: "active",
        pinned: false,
        createdAt: clock.now(),
        updatedAt: clock.now(),
        ...overrides,
      })
      .returning();
    if (!user) throw new Error("failed to insert test user");
    return user;
  }

  async function cookieFor(userId: string): Promise<string> {
    const { db } = await testDb;
    const session = await createSession(db, clock, userId);
    return `${SESSION_COOKIE_NAME}=${session.cookieValue}`;
  }

  test("lists users newest first, filterable by search, role and status", async () => {
    const { app } = await build();
    const admin = await makeUser({
      email: "admin@example.com",
      role: "admin",
    });
    const pending = await makeUser({
      email: "pending-person@example.com",
      name: "Pending Person",
      status: "pending",
    });
    await makeUser({ email: "other@example.com", name: "Other" });

    const all = await app.request("/api/admin/users", {
      headers: { ...SAME_ORIGIN_HEADERS, Cookie: await cookieFor(admin.id) },
    });
    expect(all.status).toBe(200);
    const allBody = (await all.json()) as { users: { email: string }[] };
    expect(allBody.users.map((u) => u.email)).toEqual([
      "other@example.com",
      "pending-person@example.com",
      "admin@example.com",
    ]);

    const pendingOnly = await app.request("/api/admin/users?status=pending", {
      headers: {
        ...SAME_ORIGIN_HEADERS,
        Cookie: await cookieFor(admin.id),
      },
    });
    const pendingBody = (await pendingOnly.json()) as {
      users: { id: string }[];
    };
    expect(pendingBody.users.map((u) => u.id)).toEqual([pending.id]);

    const search = await app.request("/api/admin/users?q=Pending", {
      headers: {
        ...SAME_ORIGIN_HEADERS,
        Cookie: await cookieFor(admin.id),
      },
    });
    const searchBody = (await search.json()) as { users: { id: string }[] };
    expect(searchBody.users.map((u) => u.id)).toEqual([pending.id]);
  });

  test("paginates with a keyset cursor and reports hasMore", async () => {
    const { app } = await build();
    const admin = await makeUser({ email: "admin@example.com", role: "admin" });
    const first = await makeUser({ email: "first@example.com" });
    const second = await makeUser({ email: "second@example.com" });
    const third = await makeUser({ email: "third@example.com" });
    const cookie = await cookieFor(admin.id);

    const firstPage = await app.request("/api/admin/users?limit=2", {
      headers: { ...SAME_ORIGIN_HEADERS, Cookie: cookie },
    });
    const firstBody = (await firstPage.json()) as {
      users: { id: string; createdAt: string }[];
      hasMore: boolean;
    };
    expect(firstBody.users.map((u) => u.id)).toEqual([third.id, second.id]);
    expect(firstBody.hasMore).toBe(true);

    const last = firstBody.users[1];
    if (!last) throw new Error("expected a second user");
    const secondPage = await app.request(
      `/api/admin/users?limit=2&beforeCreatedAt=${encodeURIComponent(last.createdAt)}&beforeId=${last.id}`,
      { headers: { ...SAME_ORIGIN_HEADERS, Cookie: cookie } },
    );
    const secondBody = (await secondPage.json()) as {
      users: { id: string }[];
      hasMore: boolean;
    };
    expect(secondBody.users.map((u) => u.id)).toEqual([first.id, admin.id]);
    expect(secondBody.hasMore).toBe(false);
  });

  test("pending-count counts only pending users", async () => {
    const { app } = await build();
    const admin = await makeUser({ email: "admin@example.com", role: "admin" });
    await makeUser({ email: "p1@example.com", status: "pending" });
    await makeUser({ email: "p2@example.com", status: "pending" });
    await makeUser({ email: "active@example.com" });

    const res = await app.request("/api/admin/users/pending-count", {
      headers: { ...SAME_ORIGIN_HEADERS, Cookie: await cookieFor(admin.id) },
    });
    const body = (await res.json()) as { count: number };
    expect(body.count).toBe(2);
  });

  test("GET /:id 404s for a missing user", async () => {
    const { app } = await build();
    const admin = await makeUser({ email: "admin@example.com", role: "admin" });

    const res = await app.request(
      "/api/admin/users/00000000-0000-0000-0000-000000000000",
      {
        headers: {
          ...SAME_ORIGIN_HEADERS,
          Cookie: await cookieFor(admin.id),
        },
      },
    );
    expect(res.status).toBe(404);
  });

  test("approve turns a pending user active and records an Audit entry", async () => {
    const { app, db } = await build();
    const admin = await makeUser({ email: "admin@example.com", role: "admin" });
    const pending = await makeUser({
      email: "pending@example.com",
      status: "pending",
    });

    const res = await app.request(`/api/admin/users/${pending.id}/approve`, {
      method: "POST",
      headers: { ...SAME_ORIGIN_HEADERS, Cookie: await cookieFor(admin.id) },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe("active");

    const [entry] = await db
      .select()
      .from(auditEntries)
      .where(eq(auditEntries.targetId, pending.id));
    expect(entry?.action).toBe("approve");
    expect(entry?.actorEmail).toBe("admin@example.com");
    expect(entry?.before).toEqual({ role: "user", status: "pending" });
    expect(entry?.after).toEqual({ role: "user", status: "active" });
  });

  test("approve refuses a user who isn't pending", async () => {
    const { app } = await build();
    const admin = await makeUser({ email: "admin@example.com", role: "admin" });
    const active = await makeUser({ email: "active@example.com" });

    const res = await app.request(`/api/admin/users/${active.id}/approve`, {
      method: "POST",
      headers: { ...SAME_ORIGIN_HEADERS, Cookie: await cookieFor(admin.id) },
    });
    expect(res.status).toBe(400);
  });

  test("promote and demote flip the role and record an Audit entry", async () => {
    const { app, db } = await build();
    const admin = await makeUser({ email: "admin@example.com", role: "admin" });
    const target = await makeUser({ email: "target@example.com" });

    const promoted = await app.request(
      `/api/admin/users/${target.id}/promote`,
      {
        method: "POST",
        headers: {
          ...SAME_ORIGIN_HEADERS,
          Cookie: await cookieFor(admin.id),
        },
      },
    );
    expect(promoted.status).toBe(200);
    expect(((await promoted.json()) as { role: string }).role).toBe("admin");

    const demoted = await app.request(`/api/admin/users/${target.id}/demote`, {
      method: "POST",
      headers: {
        ...SAME_ORIGIN_HEADERS,
        Cookie: await cookieFor(admin.id),
      },
    });
    expect(demoted.status).toBe(200);
    expect(((await demoted.json()) as { role: string }).role).toBe("user");

    const entries = await db
      .select()
      .from(auditEntries)
      .where(eq(auditEntries.targetId, target.id));
    expect(entries.map((e) => e.action).sort()).toEqual(["demote", "promote"]);
  });

  test("promote refuses a user who's still pending (ADR 0008: approve before promote)", async () => {
    const { app } = await build();
    const admin = await makeUser({ email: "admin@example.com", role: "admin" });
    const pending = await makeUser({
      email: "still-pending@example.com",
      status: "pending",
    });

    const res = await app.request(`/api/admin/users/${pending.id}/promote`, {
      method: "POST",
      headers: { ...SAME_ORIGIN_HEADERS, Cookie: await cookieFor(admin.id) },
    });
    expect(res.status).toBe(400);
  });

  test("pinned Admins can't be approved, promoted or demoted (404, like a missing row)", async () => {
    const { app } = await build();
    const admin = await makeUser({ email: "admin@example.com", role: "admin" });
    // Pinned because this email is listed in TEST_ENV's ADMIN_EMAILS, not
    // because of anything stored on the row (ADR 0008: read live).
    const pinned = await makeUser({
      email: "pinned-admin@example.com",
      role: "admin",
    });

    for (const action of ["approve", "promote", "demote"]) {
      const res = await app.request(`/api/admin/users/${pinned.id}/${action}`, {
        method: "POST",
        headers: {
          ...SAME_ORIGIN_HEADERS,
          Cookie: await cookieFor(admin.id),
        },
      });
      expect(res.status).toBe(404);
    }
  });

  test("removing an email from ADMIN_EMAILS unpins immediately, with no write and no Audit entry", async () => {
    const stillListed = await build();
    const admin = await makeUser({ email: "admin@example.com", role: "admin" });
    const formerlyPinned = await makeUser({
      email: "pinned-admin@example.com",
      role: "admin",
    });

    const stillPinnedRes = await stillListed.app.request(
      `/api/admin/users/${formerlyPinned.id}/demote`,
      {
        method: "POST",
        headers: { ...SAME_ORIGIN_HEADERS, Cookie: await cookieFor(admin.id) },
      },
    );
    expect(stillPinnedRes.status).toBe(404);

    const { app: appWithoutThatAdmin, db } = await build({
      ...TEST_ENV,
      ADMIN_EMAILS: ["someone-else@example.com"],
    });
    const before = await db.select().from(auditEntries);

    const unpinnedRes = await appWithoutThatAdmin.request(
      `/api/admin/users/${formerlyPinned.id}/demote`,
      {
        method: "POST",
        headers: { ...SAME_ORIGIN_HEADERS, Cookie: await cookieFor(admin.id) },
      },
    );
    expect(unpinnedRes.status).toBe(200);
    expect(((await unpinnedRes.json()) as { role: string }).role).toBe("user");

    const after = await db.select().from(auditEntries);
    // The demote itself writes one Audit entry; unpinning writes none.
    expect(after.length).toBe(before.length + 1);
  });

  test("nobody changes their own role or status (404, like a missing row)", async () => {
    const { app } = await build();
    const admin = await makeUser({ email: "admin@example.com", role: "admin" });

    for (const action of ["approve", "promote", "demote"]) {
      const res = await app.request(`/api/admin/users/${admin.id}/${action}`, {
        method: "POST",
        headers: {
          ...SAME_ORIGIN_HEADERS,
          Cookie: await cookieFor(admin.id),
        },
      });
      expect(res.status).toBe(404);
    }
  });

  test("disable drops status to disabled, stores the reason, and records an Audit entry", async () => {
    const { app, db } = await build();
    const admin = await makeUser({ email: "admin@example.com", role: "admin" });
    const target = await makeUser({ email: "target@example.com" });

    const res = await app.request(`/api/admin/users/${target.id}/disable`, {
      method: "POST",
      headers: {
        ...SAME_ORIGIN_HEADERS,
        Cookie: await cookieFor(admin.id),
        "content-type": "application/json",
      },
      body: JSON.stringify({ reason: "Abusive prompts" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe("disabled");

    const [row] = await db.select().from(users).where(eq(users.id, target.id));
    expect(row?.status).toBe("disabled");
    expect(row?.disabledReason).toBe("Abusive prompts");
    expect(row?.disabledAt).not.toBeNull();

    const [entry] = await db
      .select()
      .from(auditEntries)
      .where(eq(auditEntries.targetId, target.id));
    expect(entry?.action).toBe("disable");
    expect(entry?.after).toEqual({
      role: "user",
      status: "disabled",
      reason: "Abusive prompts",
    });
  });

  test("disable without a reason, then enable clears it and reactivates", async () => {
    const { app, db } = await build();
    const admin = await makeUser({ email: "admin@example.com", role: "admin" });
    const target = await makeUser({ email: "target@example.com" });

    const disabled = await app.request(
      `/api/admin/users/${target.id}/disable`,
      {
        method: "POST",
        headers: { ...SAME_ORIGIN_HEADERS, Cookie: await cookieFor(admin.id) },
      },
    );
    expect(disabled.status).toBe(200);

    const enabled = await app.request(`/api/admin/users/${target.id}/enable`, {
      method: "POST",
      headers: { ...SAME_ORIGIN_HEADERS, Cookie: await cookieFor(admin.id) },
    });
    expect(enabled.status).toBe(200);
    expect(((await enabled.json()) as { status: string }).status).toBe(
      "active",
    );

    const [row] = await db.select().from(users).where(eq(users.id, target.id));
    expect(row?.status).toBe("active");
    expect(row?.disabledReason).toBeNull();
    expect(row?.disabledAt).toBeNull();
  });

  test("disable deletes the target's sessions", async () => {
    const { app, db } = await build();
    const admin = await makeUser({ email: "admin@example.com", role: "admin" });
    const target = await makeUser({ email: "target@example.com" });
    await createSession(db, clock, target.id);

    const res = await app.request(`/api/admin/users/${target.id}/disable`, {
      method: "POST",
      headers: { ...SAME_ORIGIN_HEADERS, Cookie: await cookieFor(admin.id) },
    });
    expect(res.status).toBe(200);

    const remaining = await db
      .select()
      .from(sessions)
      .where(eq(sessions.userId, target.id));
    expect(remaining).toEqual([]);
  });

  test("disable refuses an already-disabled user, enable refuses one that isn't disabled", async () => {
    const { app } = await build();
    const admin = await makeUser({ email: "admin@example.com", role: "admin" });
    const target = await makeUser({ email: "target@example.com" });

    const enableTooSoon = await app.request(
      `/api/admin/users/${target.id}/enable`,
      {
        method: "POST",
        headers: { ...SAME_ORIGIN_HEADERS, Cookie: await cookieFor(admin.id) },
      },
    );
    expect(enableTooSoon.status).toBe(400);

    await app.request(`/api/admin/users/${target.id}/disable`, {
      method: "POST",
      headers: { ...SAME_ORIGIN_HEADERS, Cookie: await cookieFor(admin.id) },
    });

    const disableTwice = await app.request(
      `/api/admin/users/${target.id}/disable`,
      {
        method: "POST",
        headers: { ...SAME_ORIGIN_HEADERS, Cookie: await cookieFor(admin.id) },
      },
    );
    expect(disableTwice.status).toBe(400);
  });

  test("pinned Admins can't be disabled, and nobody disables themselves", async () => {
    const { app } = await build();
    const admin = await makeUser({ email: "admin@example.com", role: "admin" });
    const pinned = await makeUser({
      email: "pinned-admin@example.com",
      role: "admin",
    });

    const pinnedRes = await app.request(
      `/api/admin/users/${pinned.id}/disable`,
      {
        method: "POST",
        headers: { ...SAME_ORIGIN_HEADERS, Cookie: await cookieFor(admin.id) },
      },
    );
    expect(pinnedRes.status).toBe(404);

    const selfRes = await app.request(`/api/admin/users/${admin.id}/disable`, {
      method: "POST",
      headers: { ...SAME_ORIGIN_HEADERS, Cookie: await cookieFor(admin.id) },
    });
    expect(selfRes.status).toBe(404);
  });

  test("PUT /:id/caps sets overrides and records an Audit entry; null clears back to the Site default", async () => {
    const { app, db } = await build();
    const admin = await makeUser({ email: "admin@example.com", role: "admin" });
    const target = await makeUser({ email: "target@example.com" });

    const res = await app.request(`/api/admin/users/${target.id}/caps`, {
      method: "PUT",
      headers: {
        ...SAME_ORIGIN_HEADERS,
        Cookie: await cookieFor(admin.id),
        "content-type": "application/json",
      },
      body: JSON.stringify({ dailyCapOverride: 0, concurrentCapOverride: 2 }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      dailyCapOverride: number | null;
      concurrentCapOverride: number | null;
    };
    expect(body.dailyCapOverride).toBe(0);
    expect(body.concurrentCapOverride).toBe(2);

    const cleared = await app.request(`/api/admin/users/${target.id}/caps`, {
      method: "PUT",
      headers: {
        ...SAME_ORIGIN_HEADERS,
        Cookie: await cookieFor(admin.id),
        "content-type": "application/json",
      },
      body: JSON.stringify({
        dailyCapOverride: null,
        concurrentCapOverride: null,
      }),
    });
    expect(cleared.status).toBe(200);
    const clearedBody = (await cleared.json()) as {
      dailyCapOverride: number | null;
    };
    expect(clearedBody.dailyCapOverride).toBeNull();

    const entries = await db
      .select()
      .from(auditEntries)
      .where(eq(auditEntries.targetId, target.id));
    expect(entries.map((e) => e.action)).toEqual(["caps", "caps"]);
  });

  test("PUT /:id/caps refuses an out-of-range value", async () => {
    const { app } = await build();
    const admin = await makeUser({ email: "admin@example.com", role: "admin" });
    const target = await makeUser({ email: "target@example.com" });

    const res = await app.request(`/api/admin/users/${target.id}/caps`, {
      method: "PUT",
      headers: {
        ...SAME_ORIGIN_HEADERS,
        Cookie: await cookieFor(admin.id),
        "content-type": "application/json",
      },
      body: JSON.stringify({
        dailyCapOverride: 1001,
        concurrentCapOverride: 2,
      }),
    });
    expect(res.status).toBe(400);
  });

  test("DELETE /:id scrubs the row like a self-delete and records an admin-delete Audit entry", async () => {
    const { app, db } = await build();
    const admin = await makeUser({ email: "admin@example.com", role: "admin" });
    const target = await makeUser({ email: "target@example.com" });

    const res = await app.request(`/api/admin/users/${target.id}`, {
      method: "DELETE",
      headers: { ...SAME_ORIGIN_HEADERS, Cookie: await cookieFor(admin.id) },
    });
    expect(res.status).toBe(200);

    const [row] = await db.select().from(users).where(eq(users.id, target.id));
    expect(row?.email).toBe("");
    expect(row?.name).toBe("Deleted user");
    expect(row?.status).toBe("disabled");

    const [entry] = await db
      .select()
      .from(auditEntries)
      .where(eq(auditEntries.targetId, target.id));
    expect(entry?.action).toBe("admin-delete");
    expect(entry?.actorEmail).toBe("admin@example.com");
  });

  test("DELETE /:id of a disabled user blocks their Google sub from signing up again", async () => {
    const { app, db } = await build();
    const admin = await makeUser({ email: "admin@example.com", role: "admin" });
    const target = await makeUser({
      email: "target@example.com",
      status: "disabled",
      disabledReason: "Spam",
    });
    const rawSub = target.googleSub;

    const res = await app.request(`/api/admin/users/${target.id}`, {
      method: "DELETE",
      headers: { ...SAME_ORIGIN_HEADERS, Cookie: await cookieFor(admin.id) },
    });
    expect(res.status).toBe(200);

    const blocked = await isAccountBlocked(db, rawSub);
    expect(blocked).toBe(true);
  });

  test("DELETE /:id of an active (not disabled) user doesn't block their sub", async () => {
    const { app, db } = await build();
    const admin = await makeUser({ email: "admin@example.com", role: "admin" });
    const target = await makeUser({ email: "active-target@example.com" });
    const rawSub = target.googleSub;

    await app.request(`/api/admin/users/${target.id}`, {
      method: "DELETE",
      headers: { ...SAME_ORIGIN_HEADERS, Cookie: await cookieFor(admin.id) },
    });

    expect(await isAccountBlocked(db, rawSub)).toBe(false);
  });

  test("DELETE /:id refuses a pinned Admin or the acting Admin's own row", async () => {
    const { app } = await build();
    const admin = await makeUser({ email: "admin@example.com", role: "admin" });
    const pinned = await makeUser({
      email: "pinned-admin@example.com",
      role: "admin",
    });

    const pinnedRes = await app.request(`/api/admin/users/${pinned.id}`, {
      method: "DELETE",
      headers: { ...SAME_ORIGIN_HEADERS, Cookie: await cookieFor(admin.id) },
    });
    expect(pinnedRes.status).toBe(404);

    const selfRes = await app.request(`/api/admin/users/${admin.id}`, {
      method: "DELETE",
      headers: { ...SAME_ORIGIN_HEADERS, Cookie: await cookieFor(admin.id) },
    });
    expect(selfRes.status).toBe(404);
  });
});
