// `/api/privacy`: always exists, works signed out (issue #65).

import { afterAll, describe, expect, test } from "bun:test";
import { FakeClock } from "@ai-content-studio/shared";
import { createApp } from "../app.js";
import {
  getSiteSettings,
  updateSitePrivacy,
} from "../branding/site-settings-store.js";
import type { Env } from "../env.js";
import type { Logger } from "../logger.js";
import { createTestDatabase } from "../test/database.js";

const admin = {
  type: "admin" as const,
  userId: "00000000-0000-0000-0000-00000000000e",
  email: "admin@example.com",
  ip: "203.0.113.1",
  userAgent: "test-agent",
  requestId: "req-privacy-route",
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
  STATUS_TOKEN: undefined,
  MIN_FREE_DISK_GB: 10,
  MAX_UPLOAD_MB: 500,
  FFMPEG_CONCURRENCY: 2,
  LOG_RETENTION_DAYS: 30,
};

const SAME_ORIGIN_HEADERS = { "Sec-Fetch-Site": "same-origin" };

describe("/api/privacy", () => {
  const testDb = createTestDatabase("privacy_route_test");
  const clock = new FakeClock();

  afterAll(async () => {
    await (await testDb).close();
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

  test("works signed out, with a blank Operator body by default", async () => {
    const { app } = await build();
    const res = await app.request("/api/privacy", {
      headers: SAME_ORIGIN_HEADERS,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      operatorBody: string;
      operatorUpdatedAt: string | null;
      generatedBody: string;
    };
    expect(body.operatorBody).toBe("");
    expect(body.operatorUpdatedAt).toBeNull();
    expect(body.generatedBody).toContain("What this studio stores");
    expect(body.generatedBody).toContain("Studio version:");
  });

  test("returns the Operator's saved body and its last-updated time", async () => {
    const { app, db } = await build();
    const current = await getSiteSettings(db);
    const saved = await updateSitePrivacy(db, clock, admin, {
      revision: current.privacyRevision,
      body: "We run this studio from our living room.",
    });
    expect(saved.ok).toBe(true);

    const res = await app.request("/api/privacy", {
      headers: SAME_ORIGIN_HEADERS,
    });
    const body = (await res.json()) as {
      operatorBody: string;
      operatorUpdatedAt: string | null;
    };
    expect(body.operatorBody).toBe("We run this studio from our living room.");
    expect(body.operatorUpdatedAt).not.toBeNull();
  });

  test("mentions approval mode in the generated section only when sign-up is approval", async () => {
    const { app } = await build();
    const res = await app.request("/api/privacy", {
      headers: SAME_ORIGIN_HEADERS,
    });
    const body = (await res.json()) as { generatedBody: string };
    // Default sign-up mode is "approval" (see site-settings.ts).
    expect(body.generatedBody).toContain("### Approval");
  });
});
