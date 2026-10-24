// `/api/site-settings/notice-stream`: the Notice/Pause banner's SSE
// stream (issue #59) — public, so it reaches signed-out visitors too.

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { FakeClock } from "@ai-content-studio/shared";
import { createApp } from "../app.js";
import { SESSION_COOKIE_NAME, createSession } from "../auth/session.js";
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
  MAX_UPLOAD_MB: 500,
  FFMPEG_CONCURRENCY: 2,
};

const SAME_ORIGIN_HEADERS = { "Sec-Fetch-Site": "same-origin" };

async function flushMicrotasks() {
  await new Promise((resolve) => setTimeout(resolve, 20));
}

describe("/api/site-settings/notice-stream", () => {
  const testDb = createTestDatabase("site_settings_notice_stream_test");
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
    return createApp({
      db,
      sql,
      clock,
      logger: silentLogger,
      env: TEST_ENV,
      webDistDir: new URL("../../../web", import.meta.url).pathname,
    });
  }

  async function adminHeaders() {
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
    return {
      ...SAME_ORIGIN_HEADERS,
      Cookie: `${SESSION_COOKIE_NAME}=${session.cookieValue}`,
    };
  }

  async function openStream(app: Awaited<ReturnType<typeof build>>["app"]) {
    const res = await app.request("/api/site-settings/notice-stream");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const reader = res.body?.getReader();
    if (!reader) throw new Error("no stream body");
    return reader;
  }

  test("sends the current snapshot as soon as it's opened, with no session needed", async () => {
    const { app } = await build();
    const reader = await openStream(app);
    const decoder = new TextDecoder();

    const chunk = await reader.read();
    const text = decoder.decode(chunk.value);
    expect(text).toContain("event: notice");
    expect(text).toContain('"paused":false');

    await reader.cancel();
  });

  test("a Notice save reaches an already-open stream", async () => {
    const { app } = await build();
    const headers = await adminHeaders();
    const reader = await openStream(app);
    const decoder = new TextDecoder();
    await reader.read();

    const settingsRes = await app.request("/api/admin/site-settings", {
      headers,
    });
    const { noticeRevision } = (await settingsRes.json()) as {
      noticeRevision: number;
    };

    await app.request("/api/admin/site-settings/notice", {
      method: "PUT",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ revision: noticeRevision, text: "Back soon." }),
    });

    const chunk = await reader.read();
    const text = decoder.decode(chunk.value);
    expect(text).toContain("event: notice");
    expect(text).toContain("Back soon.");
    expect(text).toContain('"paused":false');

    await reader.cancel();
  });

  test("a Pause reaches an already-open stream", async () => {
    const { app } = await build();
    const headers = await adminHeaders();
    const reader = await openStream(app);
    const decoder = new TextDecoder();
    await reader.read();

    const pauseRes = await app.request("/api/admin/site-settings/pause", {
      method: "POST",
      headers,
    });
    expect(pauseRes.status).toBe(200);

    const chunk = await reader.read();
    const text = decoder.decode(chunk.value);
    expect(text).toContain("event: notice");
    expect(text).toContain('"paused":true');

    await reader.cancel();
  });

  test("sends a heartbeat every few seconds so the stream stays open", async () => {
    const { app } = await build();
    const reader = await openStream(app);
    const decoder = new TextDecoder();

    const snapshotChunk = await reader.read();
    expect(decoder.decode(snapshotChunk.value)).toContain("event: notice");

    clock.advance(5_000);
    await flushMicrotasks();

    const heartbeatChunk = await reader.read();
    expect(decoder.decode(heartbeatChunk.value)).toContain(": heartbeat");

    await reader.cancel();
  });
});
