import { afterAll, describe, expect, test } from "bun:test";
import { FakeClock } from "@ai-content-studio/shared";
import { eq } from "drizzle-orm";
import { auditEntries } from "../db/schema.js";
import { createTestDatabase } from "../test/database.js";
import { upsertUserFromGoogle } from "./users.js";

describe("upsertUserFromGoogle", () => {
  const testDb = createTestDatabase("upsert_user_test");
  const clock = new FakeClock();

  afterAll(async () => {
    await (await testDb).close();
  });

  test("promoting a brand-new ADMIN_EMAILS user writes no system Audit entry (nothing changed yet)", async () => {
    const { db } = await testDb;
    const user = await upsertUserFromGoogle(
      db,
      clock,
      {
        sub: "sub-admin-new",
        email: "new-admin@example.com",
        name: "New Admin",
        picture: null,
        emailVerified: true,
      },
      ["new-admin@example.com"],
      "approval",
    );
    expect(user.role).toBe("admin");
    expect(user.status).toBe("active");

    const entries = await db
      .select()
      .from(auditEntries)
      .where(eq(auditEntries.targetId, user.id));
    expect(entries).toHaveLength(0);
  });

  test("a sign-in that promotes an existing user to Admin writes a system Audit entry", async () => {
    const { db } = await testDb;
    const first = await upsertUserFromGoogle(
      db,
      clock,
      {
        sub: "sub-promoted",
        email: "promoted@example.com",
        name: "Promoted",
        picture: null,
        emailVerified: true,
      },
      [], // not yet an ADMIN_EMAILS entry: signs in as a plain user
      "open", // open sign-up: starts active, so this test is only about role sync
    );
    expect(first.role).toBe("user");
    expect(first.status).toBe("active");

    const second = await upsertUserFromGoogle(
      db,
      clock,
      {
        sub: "sub-promoted",
        email: "promoted@example.com",
        name: "Promoted",
        picture: null,
        emailVerified: true,
      },
      ["promoted@example.com"], // now listed: the second sign-in promotes them
      "open",
    );
    expect(second.role).toBe("admin");

    const [entry] = await db
      .select()
      .from(auditEntries)
      .where(eq(auditEntries.targetId, second.id));
    expect(entry?.actorType).toBe("system");
    expect(entry?.targetType).toBe("user");
    expect(entry?.before).toEqual({ role: "user", status: "active" });
    expect(entry?.after).toEqual({ role: "admin", status: "active" });
  });

  test("a sign-in that changes nothing writes no Audit entry", async () => {
    const { db } = await testDb;
    await upsertUserFromGoogle(
      db,
      clock,
      {
        sub: "sub-stable",
        email: "stable-admin@example.com",
        name: "Stable Admin",
        picture: null,
        emailVerified: true,
      },
      ["stable-admin@example.com"],
      "approval",
    );
    const before = await db.select().from(auditEntries);

    await upsertUserFromGoogle(
      db,
      clock,
      {
        sub: "sub-stable",
        email: "stable-admin@example.com",
        name: "Stable Admin",
        picture: null,
        emailVerified: true,
      },
      ["stable-admin@example.com"],
      "approval",
    );
    const after = await db.select().from(auditEntries);

    expect(after).toHaveLength(before.length);
  });

  test("a brand-new user is pending under approval sign-up, active under open sign-up", async () => {
    const { db } = await testDb;

    const pending = await upsertUserFromGoogle(
      db,
      clock,
      {
        sub: "sub-approval-new",
        email: "approval-new@example.com",
        name: "Approval New",
        picture: null,
        emailVerified: true,
      },
      [],
      "approval",
    );
    expect(pending.status).toBe("pending");

    const open = await upsertUserFromGoogle(
      db,
      clock,
      {
        sub: "sub-open-new",
        email: "open-new@example.com",
        name: "Open New",
        picture: null,
        emailVerified: true,
      },
      [],
      "open",
    );
    expect(open.status).toBe("active");
  });

  test("switching sign-up mode never changes an already-pending user's status", async () => {
    const { db } = await testDb;

    const first = await upsertUserFromGoogle(
      db,
      clock,
      {
        sub: "sub-stays-pending",
        email: "stays-pending@example.com",
        name: "Stays Pending",
        picture: null,
        emailVerified: true,
      },
      [],
      "approval",
    );
    expect(first.status).toBe("pending");

    // Admin switches to open sign-up; signing in again must not retroactively approve them.
    const second = await upsertUserFromGoogle(
      db,
      clock,
      {
        sub: "sub-stays-pending",
        email: "stays-pending@example.com",
        name: "Stays Pending",
        picture: null,
        emailVerified: true,
      },
      [],
      "open",
    );
    expect(second.status).toBe("pending");
  });
});
