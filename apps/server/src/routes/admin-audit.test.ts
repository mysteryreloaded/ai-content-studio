// `/api/admin/audit`: filters and live actor/target name lookups
// (issue #38).

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { FakeClock } from "@ai-content-studio/shared";
import { createApp } from "../app.js";
import { recordAuditEntry } from "../audit/audit.js";
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
};

const SAME_ORIGIN_HEADERS = { "Sec-Fetch-Site": "same-origin" };

describe("GET /api/admin/audit", () => {
  const testDb = createTestDatabase("admin_audit_route_test");
  const clock = new FakeClock(new Date("2026-01-01T00:00:00Z"));

  afterAll(async () => {
    await (await testDb).close();
  });

  // audit_entries is append-only (ADR 0005): each test uses its own
  // target ids instead of resetting the table between tests.
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

  async function makeUser(role: "user" | "admin", email: string) {
    const { db } = await testDb;
    const [user] = await db
      .insert(users)
      .values({ googleSub: `sub-${email}`, email, name: `Name ${email}`, role })
      .returning();
    if (!user) throw new Error("failed to insert test user");
    return user;
  }

  async function cookieFor(userId: string): Promise<string> {
    const { db } = await testDb;
    const session = await createSession(db, clock, userId);
    return `${SESSION_COOKIE_NAME}=${session.cookieValue}`;
  }

  test("lists entries newest first, with the Admin actor named", async () => {
    const { app, db } = await build();
    const admin = await makeUser("admin", "admin@example.com");

    await recordAuditEntry(db, clock, {
      actor: {
        type: "admin",
        userId: admin.id,
        email: admin.email,
        ip: "127.0.0.1",
        userAgent: "test-agent",
        requestId: "req-1",
      },
      targetType: "site_settings",
      targetId: "singleton",
      action: "update",
      before: { title: "Old" },
      after: { title: "New" },
    });
    clock.advance(1000);
    await recordAuditEntry(db, clock, {
      actor: { type: "system" },
      targetType: "backend",
      targetId: "b1",
      action: "create",
      before: null,
      after: { name: "GPU 1" },
    });

    const res = await app.request("/api/admin/audit", {
      headers: { ...SAME_ORIGIN_HEADERS, Cookie: await cookieFor(admin.id) },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      entries: {
        actorType: string;
        actorName: string | null;
        action: string;
      }[];
    };
    expect(body.entries).toHaveLength(2);
    // Newest first: the "backend create" by "system" was recorded second.
    expect(body.entries[0]?.action).toBe("create");
    expect(body.entries[0]?.actorType).toBe("system");
    expect(body.entries[0]?.actorName).toBeNull();
    expect(body.entries[1]?.actorName).toBe("admin@example.com");
  });

  test("a user target's name is looked up live, 'Deleted user' once gone", async () => {
    const { app, db } = await build();
    const admin = await makeUser("admin", "admin@example.com");
    const target = await makeUser("user", "target@example.com");

    await recordAuditEntry(db, clock, {
      actor: { type: "system" },
      targetType: "user",
      targetId: target.id,
      action: "promote",
      before: { role: "user" },
      after: { role: "admin" },
    });
    await recordAuditEntry(db, clock, {
      actor: { type: "system" },
      targetType: "user",
      targetId: "00000000-0000-0000-0000-000000000099",
      action: "disable",
      before: { status: "active" },
      after: { status: "disabled" },
    });

    const res = await app.request("/api/admin/audit?targetType=user", {
      headers: { ...SAME_ORIGIN_HEADERS, Cookie: await cookieFor(admin.id) },
    });
    const body = (await res.json()) as {
      entries: { targetId: string; targetName: string | null }[];
    };
    const forTarget = body.entries.find((e) => e.targetId === target.id);
    const forGone = body.entries.find(
      (e) => e.targetId === "00000000-0000-0000-0000-000000000099",
    );
    expect(forTarget?.targetName).toBe(`Name ${target.email}`);
    expect(forGone?.targetName).toBe("Deleted user");
  });

  test("filters by actor, target, action and date", async () => {
    const { app, db } = await build();
    const admin = await makeUser("admin", "admin@example.com");

    await recordAuditEntry(db, clock, {
      actor: {
        type: "admin",
        userId: admin.id,
        email: admin.email,
        ip: null,
        userAgent: null,
        requestId: "req-1",
      },
      targetType: "backend",
      targetId: "filters-test-b1",
      action: "create",
      before: null,
      after: { name: "GPU 1" },
    });
    await recordAuditEntry(db, clock, {
      actor: { type: "system" },
      targetType: "backend",
      targetId: "filters-test-b2",
      action: "create",
      before: null,
      after: { name: "GPU 2" },
    });

    const cookie = await cookieFor(admin.id);

    // The table is append-only (ADR 0005) and shared across this file's
    // tests, so each query here is additionally scoped to this test's
    // own target ids rather than asserting an exact total count.
    const byActor = await app.request(
      "/api/admin/audit?actor=system&targetType=backend",
      { headers: { ...SAME_ORIGIN_HEADERS, Cookie: cookie } },
    );
    const byActorBody = (await byActor.json()) as {
      entries: { targetId: string }[];
    };
    const byActorIds = byActorBody.entries
      .map((e) => e.targetId)
      .filter((id) => id.startsWith("filters-test-"));
    expect(byActorIds).toEqual(["filters-test-b2"]);

    const byTarget = await app.request(
      "/api/admin/audit?targetType=backend&targetId=filters-test-b1",
      { headers: { ...SAME_ORIGIN_HEADERS, Cookie: cookie } },
    );
    const byTargetBody = (await byTarget.json()) as {
      entries: { targetId: string }[];
    };
    expect(byTargetBody.entries).toHaveLength(1);
    expect(byTargetBody.entries[0]?.targetId).toBe("filters-test-b1");

    const byAction = await app.request(
      "/api/admin/audit?targetType=backend&action=create&from=2026-01-02T00:00:00Z",
      { headers: { ...SAME_ORIGIN_HEADERS, Cookie: cookie } },
    );
    const byActionBody = (await byAction.json()) as {
      entries: { targetId: string }[];
    };
    expect(
      byActionBody.entries.filter((e) =>
        e.targetId.startsWith("filters-test-"),
      ),
    ).toHaveLength(0);
  });

  test("a non-Admin cannot read the Audit trail", async () => {
    const { app } = await build();
    await makeUser("admin", "admin@example.com");
    const nonAdmin = await makeUser("user", "regular@example.com");

    const res = await app.request("/api/admin/audit", {
      headers: {
        ...SAME_ORIGIN_HEADERS,
        Cookie: await cookieFor(nonAdmin.id),
      },
    });
    expect(res.status).toBe(403);
  });
});
