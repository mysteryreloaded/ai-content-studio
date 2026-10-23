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
    );
    expect(user.role).toBe("admin");

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
    );
    expect(first.role).toBe("user");

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
    );
    const after = await db.select().from(auditEntries);

    expect(after).toHaveLength(before.length);
  });
});
