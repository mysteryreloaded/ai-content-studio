// `/api/admin/site-settings`: branding (incl. footer links) and `/privacy` (issue #65).

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { FakeClock } from "@ai-content-studio/shared";
import { createApp } from "../app.js";
import { SESSION_COOKIE_NAME, createSession } from "../auth/session.js";
import { getSiteSettings } from "../branding/site-settings-store.js";
import { users } from "../db/schema.js";
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
  FFMPEG_CONCURRENCY: 2,
};

const SAME_ORIGIN_HEADERS = { "Sec-Fetch-Site": "same-origin" };

describe("/api/admin/site-settings", () => {
  const testDb = createTestDatabase("admin_site_settings_route_test");
  const clock = new FakeClock();

  afterAll(async () => {
    await (await testDb).close();
  });

  beforeEach(async () => {
    const { db } = await testDb;
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
    if (!admin) throw new Error("failed to insert admin user");
    const session = await createSession(db, clock, admin.id);
    return `${SESSION_COOKIE_NAME}=${session.cookieValue}`;
  }

  function brandingForm(
    version: number,
    overrides: Record<string, string> = {},
  ): FormData {
    const form = new FormData();
    form.set("version", String(version));
    form.set("title", overrides.title ?? "AI Content Studio");
    form.set("landingText", "");
    form.set("accent", "teal");
    form.set("signUpMode", "approval");
    form.set("contact", "");
    form.set("footerLinks", overrides.footerLinks ?? "[]");
    return form;
  }

  describe("PUT / (branding, incl. footer links)", () => {
    test("saves up to 3 valid http(s) footer links", async () => {
      const { app, db } = await build();
      const cookie = await adminCookie();
      const current = await getSiteSettings(db);

      const res = await app.request("/api/admin/site-settings", {
        method: "PUT",
        headers: { ...SAME_ORIGIN_HEADERS, Cookie: cookie },
        body: brandingForm(current.version, {
          footerLinks: JSON.stringify([
            { label: "Imprint", url: "https://example.com/imprint" },
            { label: "Status", url: "http://status.example.com" },
          ]),
        }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        footerLinks: Array<{ label: string; url: string }>;
      };
      expect(body.footerLinks).toHaveLength(2);
    });

    test("rejects a javascript: footer link URL", async () => {
      const { app, db } = await build();
      const cookie = await adminCookie();
      const current = await getSiteSettings(db);

      const res = await app.request("/api/admin/site-settings", {
        method: "PUT",
        headers: { ...SAME_ORIGIN_HEADERS, Cookie: cookie },
        body: brandingForm(current.version, {
          footerLinks: JSON.stringify([
            { label: "Bad", url: "javascript:alert(1)" },
          ]),
        }),
      });
      expect(res.status).toBe(400);
    });

    test("rejects an ftp: footer link URL", async () => {
      const { app, db } = await build();
      const cookie = await adminCookie();
      const current = await getSiteSettings(db);

      const res = await app.request("/api/admin/site-settings", {
        method: "PUT",
        headers: { ...SAME_ORIGIN_HEADERS, Cookie: cookie },
        body: brandingForm(current.version, {
          footerLinks: JSON.stringify([
            { label: "Bad", url: "ftp://example.com/file" },
          ]),
        }),
      });
      expect(res.status).toBe(400);
    });

    test("rejects more than 3 footer links", async () => {
      const { app, db } = await build();
      const cookie = await adminCookie();
      const current = await getSiteSettings(db);

      const res = await app.request("/api/admin/site-settings", {
        method: "PUT",
        headers: { ...SAME_ORIGIN_HEADERS, Cookie: cookie },
        body: brandingForm(current.version, {
          footerLinks: JSON.stringify([
            { label: "One", url: "https://example.com/1" },
            { label: "Two", url: "https://example.com/2" },
            { label: "Three", url: "https://example.com/3" },
            { label: "Four", url: "https://example.com/4" },
          ]),
        }),
      });
      expect(res.status).toBe(400);
    });

    test("rejects a footer link label over 30 characters", async () => {
      const { app, db } = await build();
      const cookie = await adminCookie();
      const current = await getSiteSettings(db);

      const res = await app.request("/api/admin/site-settings", {
        method: "PUT",
        headers: { ...SAME_ORIGIN_HEADERS, Cookie: cookie },
        body: brandingForm(current.version, {
          footerLinks: JSON.stringify([
            { label: "x".repeat(31), url: "https://example.com" },
          ]),
        }),
      });
      expect(res.status).toBe(400);
    });
  });

  describe("PUT /privacy", () => {
    test("200s and stamps privacyUpdatedAt on a valid save", async () => {
      const { app, db } = await build();
      const cookie = await adminCookie();
      const current = await getSiteSettings(db);

      const res = await app.request("/api/admin/site-settings/privacy", {
        method: "PUT",
        headers: {
          ...SAME_ORIGIN_HEADERS,
          Cookie: cookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          revision: current.privacyRevision,
          body: "We run this studio ourselves.",
        }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        privacyBody: string;
        privacyUpdatedAt: string | null;
      };
      expect(body.privacyBody).toBe("We run this studio ourselves.");
      expect(body.privacyUpdatedAt).not.toBeNull();
    });

    test("400s over the 50,000 character limit", async () => {
      const { app, db } = await build();
      const cookie = await adminCookie();
      const current = await getSiteSettings(db);

      const res = await app.request("/api/admin/site-settings/privacy", {
        method: "PUT",
        headers: {
          ...SAME_ORIGIN_HEADERS,
          Cookie: cookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          revision: current.privacyRevision,
          body: "x".repeat(50_001),
        }),
      });
      expect(res.status).toBe(400);
    });

    test("409s on a stale revision", async () => {
      const { app, db } = await build();
      const cookie = await adminCookie();
      const current = await getSiteSettings(db);

      const res = await app.request("/api/admin/site-settings/privacy", {
        method: "PUT",
        headers: {
          ...SAME_ORIGIN_HEADERS,
          Cookie: cookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          revision: current.privacyRevision + 1,
          body: "stale write",
        }),
      });
      expect(res.status).toBe(409);
    });
  });
});
