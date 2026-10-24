import { afterAll, describe, expect, test } from "bun:test";
import { systemClock } from "@ai-content-studio/shared";
import { eq } from "drizzle-orm";
import { createApp } from "../app.js";
import { blockedAccounts, users } from "../db/schema.js";
import type { Env } from "../env.js";
import type { Logger } from "../logger.js";
import { createTestDatabase } from "../test/database.js";
import { sha256Hex } from "./account-deletion.js";

const PORT = 18532;
const BASE_URL = `http://localhost:${PORT}`;
const ISSUER = `${BASE_URL}/__mock_oidc__`;

const silentLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

async function startTestServer() {
  const testDb = await createTestDatabase("sign_in_flow_test");

  const env: Env = {
    DATABASE_URL: "unused",
    PORT,
    LOG_LEVEL: "error",
    PUBLIC_URL: BASE_URL,
    GOOGLE_CLIENT_ID: "test-client",
    GOOGLE_CLIENT_SECRET: "test-secret",
    ADMIN_EMAILS: ["admin@example.com"],
    OIDC_ISSUER: ISSUER,
    DATA_DIR: "/tmp/ai-content-studio-test-data",
    SECRET_KEY: "4FRG13w9RuN5CeV10Lzfxl78MY+AJRJtGuKrBdYzgCY=",
    BACKENDS_ENABLED: false,
    STATUS_TOKEN: undefined,
    MIN_FREE_DISK_GB: 10,
    MAX_UPLOAD_MB: 500,
    FFMPEG_CONCURRENCY: 2,
    LOG_RETENTION_DAYS: 30,
  };

  const { app } = await createApp({
    db: testDb.db,
    sql: testDb.sql,
    clock: systemClock,
    logger: silentLogger,
    env,
    webDistDir: new URL("../../../web", import.meta.url).pathname,
  });

  const server = Bun.serve({ port: PORT, fetch: app.fetch });

  return {
    testDb,
    async stop() {
      server.stop(true);
      await testDb.close();
    },
  };
}

interface MeResponse {
  email: string;
  role: "user" | "admin";
  status: "pending" | "active" | "disabled";
}

function cookieHeaderFrom(res: Response): string {
  return res.headers
    .getSetCookie()
    .map((line) => line.split(";")[0])
    .join("; ");
}

async function signIn(
  mockEmail: string,
  opts: { emailVerified?: boolean; cancel?: boolean } = {},
) {
  const start = await fetch(`${BASE_URL}/api/auth/google?return_to=/account`, {
    redirect: "manual",
  });
  expect(start.status).toBe(302);
  const flowCookies = cookieHeaderFrom(start);
  const startLocation = start.headers.get("location");
  if (!startLocation) throw new Error("expected a redirect location");
  const authorizeUrl = new URL(startLocation);

  if (opts.cancel) {
    authorizeUrl.searchParams.set("cancel", "1");
  } else {
    authorizeUrl.searchParams.set("mock_email", mockEmail);
    authorizeUrl.searchParams.set(
      "mock_email_verified",
      String(opts.emailVerified ?? true),
    );
  }

  const authorized = await fetch(authorizeUrl.toString(), {
    redirect: "manual",
  });
  expect(authorized.status).toBe(302);
  const callbackUrl = authorized.headers.get("location");
  if (!callbackUrl) throw new Error("expected a redirect location");

  const callback = await fetch(callbackUrl, {
    redirect: "manual",
    headers: { Cookie: flowCookies },
  });

  return { callback, flowCookies };
}

describe("sign-in flow against the mock OIDC issuer", () => {
  const server = startTestServer();

  afterAll(async () => {
    await (await server).stop();
  });

  test("a new user is pending under the default approval sign-up, with a session that /api/auth/me reflects", async () => {
    await server;
    const { callback } = await signIn("new-user@example.com");

    expect(callback.status).toBe(302);
    expect(callback.headers.get("location")).toBe("/account");
    const sessionCookie = cookieHeaderFrom(callback);
    expect(sessionCookie).toContain("__Host-session=");

    const me = await fetch(`${BASE_URL}/api/auth/me`, {
      headers: { Cookie: sessionCookie },
    });
    expect(me.status).toBe(200);
    const body = (await me.json()) as MeResponse;
    expect(body.email).toBe("new-user@example.com");
    expect(body.role).toBe("user");
    expect(body.status).toBe("pending");

    const { testDb } = await server;
    const [row] = await testDb.db
      .select()
      .from(users)
      .where(eq(users.email, "new-user@example.com"));
    expect(row?.pinned).toBe(false);
  });

  test("an ADMIN_EMAILS email is promoted and pinned at sign-in", async () => {
    await server;
    const { callback } = await signIn("admin@example.com");
    const sessionCookie = cookieHeaderFrom(callback);

    const me = await fetch(`${BASE_URL}/api/auth/me`, {
      headers: { Cookie: sessionCookie },
    });
    const body = (await me.json()) as MeResponse;
    expect(body.role).toBe("admin");

    const admin = await fetch(`${BASE_URL}/api/admin`, {
      headers: { Cookie: sessionCookie },
    });
    expect(admin.status).toBe(200);

    const { testDb } = await server;
    const [row] = await testDb.db
      .select()
      .from(users)
      .where(eq(users.email, "admin@example.com"));
    expect(row?.pinned).toBe(true);
  });

  test("a cancelled sign-in redirects to the landing page with auth_error=cancelled", async () => {
    await server;
    const { callback } = await signIn("irrelevant@example.com", {
      cancel: true,
    });
    expect(callback.status).toBe(302);
    expect(callback.headers.get("location")).toBe("/?auth_error=cancelled");
  });

  test("an unverified email redirects with auth_error=unverified", async () => {
    await server;
    const { callback } = await signIn("unverified@example.com", {
      emailVerified: false,
    });
    expect(callback.status).toBe(302);
    expect(callback.headers.get("location")).toBe("/?auth_error=unverified");
  });

  // Issue #64: a disabled user's status survives sign-in (upsertUserFromGoogle
  // never touches it for a non-Admin), so no session is created for them.
  test("a disabled user signing in gets auth_error=disabled and no session", async () => {
    const { testDb } = await server;
    await testDb.db.insert(users).values({
      googleSub: "mock-disabled@example.com",
      email: "disabled@example.com",
      name: "Disabled User",
      role: "user",
      status: "disabled",
      disabledReason: "Spam",
    });

    const { callback } = await signIn("disabled@example.com");
    expect(callback.status).toBe(302);
    expect(callback.headers.get("location")).toBe("/?auth_error=disabled");
    expect(cookieHeaderFrom(callback)).not.toContain("__Host-session=");
  });

  // Issue #64: an Admin delete of a disabled user blocks that Google
  // account from signing up again as a brand-new user.
  test("a blocked Google sub gets auth_error=blocked and no user row is created", async () => {
    const { testDb } = await server;
    const [blockedUser] = await testDb.db
      .insert(users)
      .values({
        googleSub: sha256Hex("mock-blocked@example.com:deleted"),
        email: "",
        name: "Deleted user",
        role: "user",
        status: "disabled",
        deletedAt: new Date(),
      })
      .returning();
    if (!blockedUser) throw new Error("failed to insert test user");
    await testDb.db.insert(blockedAccounts).values({
      subHash: sha256Hex("mock-blocked@example.com"),
      userId: blockedUser.id,
      reason: "Abusive prompts",
    });

    const { callback } = await signIn("blocked@example.com");
    expect(callback.status).toBe(302);
    expect(callback.headers.get("location")).toBe("/?auth_error=blocked");
    expect(cookieHeaderFrom(callback)).not.toContain("__Host-session=");

    const [row] = await testDb.db
      .select()
      .from(users)
      .where(eq(users.email, "blocked@example.com"));
    expect(row).toBeUndefined();
  });
});
