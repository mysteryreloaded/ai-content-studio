import { afterAll, describe, expect, test } from "bun:test";
import { FakeClock } from "@ai-content-studio/shared";
import { eq } from "drizzle-orm";
import { auditEntries } from "../db/schema.js";
import { createTestDatabase } from "../test/database.js";
import { recordAuditEntry } from "./audit.js";

describe("audit entries", () => {
  const testDb = createTestDatabase("audit_test");
  const clock = new FakeClock(new Date("2026-01-01T00:00:00Z"));

  afterAll(async () => {
    await (await testDb).close();
  });

  test("recordAuditEntry writes an Admin-named row", async () => {
    const { db } = await testDb;
    await recordAuditEntry(db, clock, {
      actor: {
        type: "admin",
        userId: "00000000-0000-0000-0000-000000000001",
        email: "admin@example.com",
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

    const [row] = await db
      .select()
      .from(auditEntries)
      .where(eq(auditEntries.targetId, "singleton"));
    expect(row?.actorType).toBe("admin");
    expect(row?.actorEmail).toBe("admin@example.com");
    expect(row?.before).toEqual({ title: "Old" });
    expect(row?.after).toEqual({ title: "New" });
  });

  test("a system actor is recorded with no email, IP or user agent", async () => {
    const { db } = await testDb;
    await recordAuditEntry(db, clock, {
      actor: { type: "system" },
      targetType: "user",
      targetId: "00000000-0000-0000-0000-000000000002",
      action: "promote",
      before: { role: "user" },
      after: { role: "admin" },
    });

    const [row] = await db
      .select()
      .from(auditEntries)
      .where(eq(auditEntries.action, "promote"));
    expect(row?.actorType).toBe("system");
    expect(row?.actorEmail).toBeNull();
  });

  test("audit entries are append-only: UPDATE and DELETE are refused", async () => {
    const { db } = await testDb;
    await recordAuditEntry(db, clock, {
      actor: { type: "system" },
      targetType: "user",
      targetId: "immutable-target",
      action: "approve",
      before: null,
      after: { status: "active" },
    });

    const before = await db
      .select()
      .from(auditEntries)
      .where(eq(auditEntries.targetId, "immutable-target"));
    expect(before).toHaveLength(1);

    let updateError: unknown;
    try {
      await db
        .update(auditEntries)
        .set({ action: "tampered" })
        .where(eq(auditEntries.targetId, "immutable-target"));
    } catch (error) {
      updateError = error;
    }
    expect(updateError).toBeDefined();

    let deleteError: unknown;
    try {
      await db
        .delete(auditEntries)
        .where(eq(auditEntries.targetId, "immutable-target"));
    } catch (error) {
      deleteError = error;
    }
    expect(deleteError).toBeDefined();
  });
});
