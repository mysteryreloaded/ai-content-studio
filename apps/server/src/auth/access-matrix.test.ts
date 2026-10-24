import { afterAll, describe, expect, test } from "bun:test";
import { FakeClock } from "@ai-content-studio/shared";
import { createApp } from "../app.js";
import { users } from "../db/schema.js";
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
    if (!activeUser || !adminUser)
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
    };

    // A route that needs a request body to do anything (e.g. a save)
    // still enforces access before parsing it, but a bodyless call from
    // an Admin fails validation rather than succeeding — that is a
    // different test's job, so only its status code is overridden here.
    const ADMIN_STATUS_OVERRIDES: Record<string, number> = {
      "PUT /api/admin/site-settings": 400,
      "POST /api/admin/backends": 400,
      "GET /api/admin/backends/:id": 404,
      "PUT /api/admin/backends/:id": 404,
      "DELETE /api/admin/backends/:id": 404,
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
        expect(`${context} active -> ${activeRes.status}`).toBe(
          `${context} active -> ${expected.active}`,
        );

        const adminRes = await app.request(route.path, {
          method: route.method,
          headers: {
            ...SAME_ORIGIN_HEADERS,
            Cookie: await cookieFor(adminUser.id),
          },
        });
        const expectedAdmin =
          ADMIN_STATUS_OVERRIDES[`${route.method} ${route.path}`] ??
          expected.admin;
        expect(`${context} admin -> ${adminRes.status}`).toBe(
          `${context} admin -> ${expectedAdmin}`,
        );
      }
    }
  });
});
