import { afterAll, describe, expect, test } from "bun:test";
import { FakeClock } from "@ai-content-studio/shared";
import { eq } from "drizzle-orm";
import { createApp } from "../app.js";
import { siteSettings, users } from "../db/schema.js";
import type { Env } from "../env.js";
import type { Logger } from "../logger.js";
import { createTestDatabase } from "../test/database.js";
import { SESSION_COOKIE_NAME, createSession } from "./session.js";

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
};

describe("every route's access level is declared and enforced", () => {
  const testDb = createTestDatabase("access_matrix_test");
  const clock = new FakeClock();

  afterAll(async () => {
    await (await testDb).close();
  });

  async function build() {
    const { db, sql } = await testDb;
    const { app, routes } = await createApp({
      db,
      sql,
      clock,
      logger: silentLogger,
      env: TEST_ENV,
      webDistDir: new URL("../../../web", import.meta.url).pathname,
    });
    return { app, routes, db };
  }

  test("no registered route is missing an access level", async () => {
    const { routes } = await build();
    expect(routes.length).toBeGreaterThan(0);
    for (const route of routes) {
      expect([
        "public",
        "signed-in",
        "active",
        "admin",
        "status-token",
        "admin-or-status-token",
      ]).toContain(route.access);
    }
  });

  test("anonymous, active and Admin get the expected status for every route", async () => {
    const { app, routes, db } = await build();

    const [activeUser] = await db
      .insert(users)
      .values({
        googleSub: "sub-active",
        email: "active@example.com",
        name: "Active User",
        role: "user",
        status: "active",
      })
      .returning();
    const [adminUser] = await db
      .insert(users)
      .values({
        googleSub: "sub-admin",
        email: "admin-user@example.com",
        name: "Admin User",
        role: "admin",
        status: "active",
      })
      .returning();
    // Issue #62: a pending user (waiting for an Admin's approval) must be
    // blocked from every `active`/`admin` route the same as before, even
    // though they do have a session.
    const [pendingUser] = await db
      .insert(users)
      .values({
        googleSub: "sub-pending",
        email: "pending@example.com",
        name: "Pending User",
        role: "user",
        status: "pending",
      })
      .returning();
    if (!activeUser || !adminUser || !pendingUser)
      throw new Error("failed to insert test users");

    // A fresh session per request: some routes (sign-out) delete the
    // session they're called with, which must not affect other routes.
    async function cookieFor(userId: string): Promise<string> {
      const session = await createSession(db, clock, userId);
      return `${SESSION_COOKIE_NAME}=${session.cookieValue}`;
    }

    const SAME_ORIGIN_HEADERS = { "Sec-Fetch-Site": "same-origin" };

    // A public route's success status varies (200 for data, 302 for the
    // sign-in redirect), so only the "must never be blocked" floor is
    // checked for `public`: it must not be 401/403 for anyone.
    const expectations: Record<string, { active: number; admin: number }> = {
      "signed-in": { active: 200, admin: 200 },
      active: { active: 200, admin: 200 },
      admin: { active: 403, admin: 200 },
      "admin-or-status-token": { active: 403, admin: 200 },
    };

    // A route that needs a request body to do anything (e.g. a save)
    // still enforces access before parsing it, but a bodyless call from
    // an Admin fails validation rather than succeeding — that is a
    // different test's job, so only its status code is overridden here.
    const ADMIN_STATUS_OVERRIDES: Record<string, number> = {
      "PUT /api/admin/site-settings": 400,
      "PUT /api/admin/site-settings/terms": 400,
      "PUT /api/admin/site-settings/privacy": 400,
      "PUT /api/admin/site-settings/blocked-words": 400,
      "PUT /api/admin/site-settings/notice": 400,
      "PUT /api/admin/site-settings/caps": 400,
      "POST /api/admin/backends": 400,
      "GET /api/admin/backends/:id": 404,
      "PUT /api/admin/backends/:id": 404,
      "DELETE /api/admin/backends/:id": 404,
      "PATCH /api/admin/backends/:id/enabled": 404,
      "PATCH /api/admin/backends/:id/draining": 404,
      "POST /api/admin/models": 400,
      "GET /api/admin/models/:id": 404,
      "PUT /api/admin/models/:id": 404,
      "DELETE /api/admin/models/:id": 404,
      "POST /api/admin/models/:id/move-up": 404,
      "POST /api/admin/models/:id/move-down": 404,
      "GET /api/admin/users/:id": 404,
      "POST /api/admin/users/:id/approve": 404,
      "POST /api/admin/users/:id/promote": 404,
      "POST /api/admin/users/:id/demote": 404,
      "GET /api/admin/models/:id/backends": 404,
      "POST /api/admin/models/:id/backends": 404,
      "DELETE /api/admin/models/:id/backends/:backendId": 404,
      "PUT /api/admin/models/:id/modes": 404,
      "PUT /api/admin/models/:id/inputs": 404,
      "PUT /api/admin/models/:id/terms": 404,
      "POST /api/admin/models/:id/enable": 404,
      "POST /api/admin/models/:id/disable": 404,
    };

    // No Site terms are set in this test's database, so accepting them
    // fails validation (400 "no_terms") before the access check matters
    // — not a different status per role, so it overrides both columns.
    const BOTH_STATUS_OVERRIDES: Record<string, number> = {
      "POST /api/terms/accept": 400,
    };

    // Unlike ADMIN_STATUS_OVERRIDES, these routes' handler runs for an
    // active user too (not just an Admin), so both columns move off
    // `expected.*`. Unlike BOTH_STATUS_OVERRIDES, a pending user must
    // still be blocked by the `active` guard before reaching the
    // handler, so pending stays untouched (403).
    const ACTIVE_AND_ADMIN_STATUS_OVERRIDES: Record<string, number> = {
      "GET /api/models/:slug": 404,
      "GET /api/models/:slug/generations": 404,
      "POST /api/models/:slug/generations": 400,
      // No Asset with this fake id exists in this test's database.
      "GET /api/assets/:id": 404,
      "GET /api/assets/:id/poster": 404,
      "GET /api/assets/:id/thumb": 404,
      "POST /api/models/:slug/terms/accept": 404,
      "POST /api/submissions/:submissionId/cancel": 404,
      // Issue #50: a bodyless create fails validation; no Upload with
      // this fake id exists.
      "POST /api/uploads": 400,
      "GET /api/uploads/:id/status": 404,
      "PUT /api/uploads/:id/chunk": 404,
      "POST /api/uploads/:id/complete": 404,
      "GET /api/uploads/:id": 404,
      "GET /api/uploads/:id/thumb": 404,
    };

    // A pending user has a session but no approval yet: `signed-in`
    // stays reachable (so they can accept the Site terms), `active`/
    // `admin` stay blocked exactly like a disabled user.
    const pendingExpectations: Record<string, number | undefined> = {
      "signed-in": 200,
      active: 403,
      admin: 403,
      "admin-or-status-token": 403,
    };

    for (const route of routes) {
      if (route.access === "status-token") continue;

      const context = `${route.method} ${route.path} (${route.access})`;

      const anonymousRes = await app.request(route.path, {
        method: route.method,
        headers: SAME_ORIGIN_HEADERS,
      });
      if (route.access === "public") {
        expect([401, 403]).not.toContain(anonymousRes.status);
      } else {
        expect(`${context} anonymous -> ${anonymousRes.status}`).toBe(
          `${context} anonymous -> 401`,
        );
      }

      const expected = expectations[route.access];

      if (expected) {
        const activeRes = await app.request(route.path, {
          method: route.method,
          headers: {
            ...SAME_ORIGIN_HEADERS,
            Cookie: await cookieFor(activeUser.id),
          },
        });
        const routeKey = `${route.method} ${route.path}`;
        const expectedActive =
          BOTH_STATUS_OVERRIDES[routeKey] ??
          ACTIVE_AND_ADMIN_STATUS_OVERRIDES[routeKey] ??
          expected.active;
        expect(`${context} active -> ${activeRes.status}`).toBe(
          `${context} active -> ${expectedActive}`,
        );

        const adminRes = await app.request(route.path, {
          method: route.method,
          headers: {
            ...SAME_ORIGIN_HEADERS,
            Cookie: await cookieFor(adminUser.id),
          },
        });
        const expectedAdmin =
          BOTH_STATUS_OVERRIDES[routeKey] ??
          ACTIVE_AND_ADMIN_STATUS_OVERRIDES[routeKey] ??
          ADMIN_STATUS_OVERRIDES[routeKey] ??
          expected.admin;
        expect(`${context} admin -> ${adminRes.status}`).toBe(
          `${context} admin -> ${expectedAdmin}`,
        );
      }

      const expectedPending =
        BOTH_STATUS_OVERRIDES[`${route.method} ${route.path}`] ??
        pendingExpectations[route.access];
      if (expectedPending !== undefined) {
        const pendingRes = await app.request(route.path, {
          method: route.method,
          headers: {
            ...SAME_ORIGIN_HEADERS,
            Cookie: await cookieFor(pendingUser.id),
          },
        });
        expect(`${context} pending -> ${pendingRes.status}`).toBe(
          `${context} pending -> ${expectedPending}`,
        );
        if (
          route.access === "active" ||
          route.access === "admin" ||
          route.access === "admin-or-status-token"
        ) {
          const body = (await pendingRes.json()) as { error: string };
          expect(body.error).toBe("pending");
        }
      }
    }
  });

  test("active without terms: signed in and active, but Site terms are set and not yet accepted", async () => {
    const { app, routes, db } = await build();

    await db
      .update(siteSettings)
      .set({ termsBody: "Do not be evil.", termsVersion: 1 })
      .where(eq(siteSettings.singleton, true));

    const SAME_ORIGIN_HEADERS = { "Sec-Fetch-Site": "same-origin" };

    // A fresh user (and so a fresh, unaccepted session) per request: this
    // sweep calls every route, including `POST /api/terms/accept` itself
    // (a `signed-in` route), which would otherwise accept the terms for
    // one shared user partway through and make every later route in the
    // list wrongly pass the gate for the rest of the sweep.
    let nextUserSuffix = 0;
    async function cookieFor(): Promise<string> {
      nextUserSuffix += 1;
      const [user] = await db
        .insert(users)
        .values({
          googleSub: `sub-no-terms-${nextUserSuffix}`,
          email: `no-terms-${nextUserSuffix}@example.com`,
          name: "No Terms User",
          role: "admin",
          status: "active",
        })
        .returning();
      if (!user) throw new Error("failed to insert test user");
      const session = await createSession(db, clock, user.id);
      return `${SESSION_COOKIE_NAME}=${session.cookieValue}`;
    }

    // Admin role is used here too: issue #60 requires "every user, Admins
    // included" to accept, so even an admin route must be blocked.
    const expectedByAccess: Record<string, number | null> = {
      public: null, // varies; only checked for "not blocked" below
      "signed-in": 200,
      active: 403,
      admin: 403,
      "admin-or-status-token": 403,
    };

    for (const route of routes) {
      if (route.access === "status-token") continue;
      const context = `${route.method} ${route.path} (${route.access})`;

      const res = await app.request(route.path, {
        method: route.method,
        headers: { ...SAME_ORIGIN_HEADERS, Cookie: await cookieFor() },
      });

      if (route.access === "public") {
        expect([401, 403]).not.toContain(res.status);
        continue;
      }

      if (route.access === "signed-in") {
        expect(`${context} -> ${res.status}`).toBe(`${context} -> 200`);
        continue;
      }

      const expected = expectedByAccess[route.access];
      expect(`${context} -> ${res.status}`).toBe(`${context} -> ${expected}`);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe("terms_required");
    }
  });

  test("ADR 0008: the terms gate comes before the pending check, for a pending user too", async () => {
    const { app, routes, db } = await build();

    await db
      .update(siteSettings)
      .set({ termsBody: "Do not be evil.", termsVersion: 1 })
      .where(eq(siteSettings.singleton, true));

    const [pendingNoTerms] = await db
      .insert(users)
      .values({
        googleSub: "sub-pending-no-terms",
        email: "pending-no-terms@example.com",
        name: "Pending No Terms",
        role: "user",
        status: "pending",
      })
      .returning();
    if (!pendingNoTerms) throw new Error("failed to insert test user");

    const SAME_ORIGIN_HEADERS = { "Sec-Fetch-Site": "same-origin" };
    const session = await createSession(db, clock, pendingNoTerms.id);
    const cookie = `${SESSION_COOKIE_NAME}=${session.cookieValue}`;

    for (const route of routes) {
      if (route.access !== "active" && route.access !== "admin") continue;

      const res = await app.request(route.path, {
        method: route.method,
        headers: { ...SAME_ORIGIN_HEADERS, Cookie: cookie },
      });
      const context = `${route.method} ${route.path} (${route.access})`;
      expect(`${context} -> ${res.status}`).toBe(`${context} -> 403`);
      const body = (await res.json()) as { error: string };
      // Not "pending": a user who hasn't accepted the current Site
      // terms is asked for that first, no matter their status.
      expect(body.error).toBe("terms_required");
    }
  });
});
