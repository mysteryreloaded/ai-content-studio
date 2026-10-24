// `/api/terms`: the `/terms` page's data, and accepting the current version.

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { FakeClock } from "@ai-content-studio/shared";
import { eq } from "drizzle-orm";
import { createApp } from "../app.js";
import { SESSION_COOKIE_NAME, createSession } from "../auth/session.js";
import {
  getSiteSettings,
  updateSiteTerms,
} from "../branding/site-settings-store.js";
import { siteSettings, users } from "../db/schema.js";
import type { Env } from "../env.js";
import type { Logger } from "../logger.js";
import { createTestDatabase } from "../test/database.js";

const admin = {
  type: "admin" as const,
  userId: "00000000-0000-0000-0000-00000000000d",
  email: "admin@example.com",
  ip: "203.0.113.1",
  userAgent: "test-agent",
  requestId: "req-terms-route",
};

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

const SAME_ORIGIN_HEADERS = { "Sec-Fetch-Site": "same-origin" };

describe("/api/terms", () => {
  const testDb = createTestDatabase("terms_route_test");
  const clock = new FakeClock();

  afterAll(async () => {
    await (await testDb).close();
  });

  beforeEach(async () => {
    const { db } = await testDb;
    await db.delete(users);
    await db
      .update(siteSettings)
      .set({ termsBody: "", termsVersion: null, termsVersionCreatedAt: null })
      .where(eq(siteSettings.singleton, true));
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

  test("GET works signed out, and with no terms set returns a null version", async () => {
    const { app } = await build();
    const res = await app.request("/api/terms", {
      headers: SAME_ORIGIN_HEADERS,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      version: null,
      body: "",
      versionDate: null,
    });
  });

  test("GET returns the current body and version once terms are set", async () => {
    const { app, db } = await build();
    await db
      .update(siteSettings)
      .set({
        termsBody: "Be nice.",
        termsVersion: 3,
        termsVersionCreatedAt: clock.now(),
      })
      .where(eq(siteSettings.singleton, true));

    const res = await app.request("/api/terms", {
      headers: SAME_ORIGIN_HEADERS,
    });
    const body = (await res.json()) as {
      version: number | null;
      body: string;
      versionDate: string | null;
    };
    expect(body.version).toBe(3);
    expect(body.body).toBe("Be nice.");
    expect(body.versionDate).not.toBeNull();
  });

  test("accepting with no terms set is refused", async () => {
    const { app, db } = await build();
    const [user] = await db
      .insert(users)
      .values({
        googleSub: "sub-accept-none",
        email: "accept-none@example.com",
        name: "Accept None",
        role: "user",
        status: "active",
      })
      .returning();
    if (!user) throw new Error("failed to insert test user");
    const session = await createSession(db, clock, user.id);

    const res = await app.request("/api/terms/accept", {
      method: "POST",
      headers: {
        ...SAME_ORIGIN_HEADERS,
        Cookie: `${SESSION_COOKIE_NAME}=${session.cookieValue}`,
      },
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "no_terms" });
  });

  test("accepting records the current version, which then clears the gate", async () => {
    const { app, db } = await build();
    await db
      .update(siteSettings)
      .set({
        termsBody: "Be nice.",
        termsVersion: 5,
        termsVersionCreatedAt: clock.now(),
      })
      .where(eq(siteSettings.singleton, true));

    const [user] = await db
      .insert(users)
      .values({
        googleSub: "sub-accept",
        email: "accept@example.com",
        name: "Accept",
        role: "user",
        status: "active",
      })
      .returning();
    if (!user) throw new Error("failed to insert test user");
    const session = await createSession(db, clock, user.id);
    const cookie = `${SESSION_COOKIE_NAME}=${session.cookieValue}`;

    const blockedRes = await app.request("/api/models", {
      headers: { ...SAME_ORIGIN_HEADERS, Cookie: cookie },
    });
    expect(blockedRes.status).toBe(403);
    expect(await blockedRes.json()).toEqual({ error: "terms_required" });

    const acceptRes = await app.request("/api/terms/accept", {
      method: "POST",
      headers: { ...SAME_ORIGIN_HEADERS, Cookie: cookie },
    });
    expect(acceptRes.status).toBe(200);
    expect(await acceptRes.json()).toEqual({ ok: true, version: 5 });

    const afterRes = await app.request("/api/models", {
      headers: { ...SAME_ORIGIN_HEADERS, Cookie: cookie },
    });
    expect(afterRes.status).toBe(200);

    const [updatedUser] = await db
      .select({ termsAcceptedVersion: users.termsAcceptedVersion })
      .from(users)
      .where(eq(users.id, user.id));
    expect(updatedUser?.termsAcceptedVersion).toBe(5);
  });

  test("a user who accepted v1, after it's cleared and replaced, is gated again under a new version (never the reused old one)", async () => {
    const { app, db } = await build();

    const initial = await getSiteSettings(db);
    const firstSave = await updateSiteTerms(db, clock, admin, {
      revision: initial.termsRevision,
      body: "Original terms.",
      askAgain: false,
    });
    expect(firstSave.ok).toBe(true);
    if (!firstSave.ok) throw new Error("expected ok");
    const firstVersion = firstSave.settings.termsVersion;
    expect(firstVersion).toBe(1);

    const [user] = await db
      .insert(users)
      .values({
        googleSub: "sub-reuse",
        email: "reuse@example.com",
        name: "Reuse",
        role: "user",
        status: "active",
      })
      .returning();
    if (!user) throw new Error("failed to insert test user");
    const session = await createSession(db, clock, user.id);
    const cookie = `${SESSION_COOKIE_NAME}=${session.cookieValue}`;

    const acceptRes = await app.request("/api/terms/accept", {
      method: "POST",
      headers: { ...SAME_ORIGIN_HEADERS, Cookie: cookie },
    });
    expect(acceptRes.status).toBe(200);

    const okRes = await app.request("/api/models", {
      headers: { ...SAME_ORIGIN_HEADERS, Cookie: cookie },
    });
    expect(okRes.status).toBe(200);

    const cleared = await updateSiteTerms(db, clock, admin, {
      revision: firstSave.settings.termsRevision,
      body: "",
      askAgain: false,
    });
    expect(cleared.ok).toBe(true);
    if (!cleared.ok) throw new Error("expected ok");

    const resumed = await updateSiteTerms(db, clock, admin, {
      revision: cleared.settings.termsRevision,
      body: "All-new terms.",
      askAgain: false,
    });
    expect(resumed.ok).toBe(true);
    if (!resumed.ok) throw new Error("expected ok");
    expect(resumed.settings.termsVersion).not.toBe(firstVersion);

    const blockedAgainRes = await app.request("/api/models", {
      headers: { ...SAME_ORIGIN_HEADERS, Cookie: cookie },
    });
    expect(blockedAgainRes.status).toBe(403);
    expect(await blockedAgainRes.json()).toEqual({ error: "terms_required" });
  });
});
