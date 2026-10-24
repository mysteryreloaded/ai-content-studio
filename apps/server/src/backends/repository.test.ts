import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { FakeClock } from "@ai-content-studio/shared";
import { eq } from "drizzle-orm";
import type { AuditActor } from "../audit/audit.js";
import { auditEntries, backends, logEntries } from "../db/schema.js";
import { createTestDatabase } from "../test/database.js";
import {
  BackendRepository,
  NameTaken,
  NotFound,
  StaleVersion,
} from "./repository.js";
import { ValidationFailed } from "./validation.js";

const SECRET_KEY = randomBytes(32).toString("base64");
const SYSTEM: AuditActor = { type: "system" };

async function auditEntriesFor(
  db: Awaited<ReturnType<typeof createTestDatabase>>["db"],
  backendId: string,
) {
  return db
    .select()
    .from(auditEntries)
    .where(eq(auditEntries.targetId, backendId));
}

describe("BackendRepository", () => {
  const testDb = createTestDatabase("backends_repository_test");
  const clock = new FakeClock();

  afterAll(async () => {
    await (await testDb).close();
  });

  beforeEach(async () => {
    const { db } = await testDb;
    await db.delete(logEntries);
    await db.delete(backends);
  });

  async function repo() {
    const { db } = await testDb;
    return new BackendRepository(db, clock, SECRET_KEY);
  }

  test("creates a Backend and writes an audit entry for it", async () => {
    const { db } = await testDb;
    const repository = await repo();
    const record = await repository.create(
      { name: "GPU 1", baseUrl: "http://localhost:8188", auth: "none" },
      SYSTEM,
    );
    expect(record.name).toBe("GPU 1");
    expect(record.version).toBe(1);

    const [entry] = await auditEntriesFor(db, record.id);
    expect(entry?.action).toBe("create");
    expect(entry?.actorType).toBe("system");
    expect((entry?.after as { credentials: string })?.credentials).toBe(
      "unchanged",
    );
  });

  test("rejects a duplicate name", async () => {
    const repository = await repo();
    await repository.create(
      { name: "GPU 1", baseUrl: "http://a", auth: "none" },
      SYSTEM,
    );
    await expect(
      repository.create(
        { name: "GPU 1", baseUrl: "http://b", auth: "none" },
        SYSTEM,
      ),
    ).rejects.toThrow(NameTaken);
  });

  test("rejects invalid input before touching the database", async () => {
    const repository = await repo();
    await expect(
      repository.create(
        { name: "", baseUrl: "http://a", auth: "none" },
        SYSTEM,
      ),
    ).rejects.toThrow(ValidationFailed);
  });

  test("rejects creating a header-auth Backend with no header name", async () => {
    const repository = await repo();
    await expect(
      repository.create(
        {
          name: "GPU 1",
          baseUrl: "http://a",
          auth: "header",
          headerValue: "v",
        },
        SYSTEM,
      ),
    ).rejects.toThrow(ValidationFailed);

    expect(await repository.list()).toEqual([]);
  });

  test("rejects creating a header-auth Backend with no credential value", async () => {
    const repository = await repo();
    await expect(
      repository.create(
        {
          name: "GPU 1",
          baseUrl: "http://a",
          auth: "header",
          headerName: "X-Api-Key",
        },
        SYSTEM,
      ),
    ).rejects.toThrow(ValidationFailed);
  });

  test("rejects creating a basic-auth Backend with no user/pass", async () => {
    const repository = await repo();
    await expect(
      repository.create(
        { name: "GPU 1", baseUrl: "http://a", auth: "basic" },
        SYSTEM,
      ),
    ).rejects.toThrow(ValidationFailed);
  });

  test("stores basic credentials encrypted and marks the audit entry 'set'", async () => {
    const { db } = await testDb;
    const repository = await repo();
    const record = await repository.create(
      {
        name: "GPU 1",
        baseUrl: "http://a",
        auth: "basic",
        basicUser: "u",
        basicPass: "p",
      },
      SYSTEM,
    );

    const creds = await repository.decryptedCredentials(record.id);
    expect(creds).toEqual({ user: "u", pass: "p" });

    const [entry] = await auditEntriesFor(db, record.id);
    expect((entry?.after as { credentials: string })?.credentials).toBe("set");
  });

  test("update with a blank credential field keeps the existing credentials", async () => {
    const repository = await repo();
    const record = await repository.create(
      {
        name: "GPU 1",
        baseUrl: "http://a",
        auth: "basic",
        basicUser: "u",
        basicPass: "p",
      },
      SYSTEM,
    );
    const updated = await repository.update(
      record.id,
      { name: "GPU 1 renamed", baseUrl: "http://a", auth: "basic" },
      record.version,
      SYSTEM,
    );
    expect(updated.name).toBe("GPU 1 renamed");

    const creds = await repository.decryptedCredentials(record.id);
    expect(creds).toEqual({ user: "u", pass: "p" });
  });

  test("update with new credentials marks the audit entry 'changed'", async () => {
    const { db } = await testDb;
    const repository = await repo();
    const record = await repository.create(
      {
        name: "GPU 1",
        baseUrl: "http://a",
        auth: "basic",
        basicUser: "u",
        basicPass: "p",
      },
      SYSTEM,
    );
    await repository.update(
      record.id,
      {
        name: "GPU 1",
        baseUrl: "http://a",
        auth: "basic",
        basicUser: "u2",
        basicPass: "p2",
      },
      record.version,
      SYSTEM,
    );
    const creds = await repository.decryptedCredentials(record.id);
    expect(creds).toEqual({ user: "u2", pass: "p2" });

    const entries = await auditEntriesFor(db, record.id);
    const updateEntry = entries.find((e) => e.action === "update");
    expect((updateEntry?.after as { credentials: string })?.credentials).toBe(
      "changed",
    );
  });

  test("switching auth to none clears credentials, marked 'cleared'", async () => {
    const { db } = await testDb;
    const repository = await repo();
    const record = await repository.create(
      {
        name: "GPU 1",
        baseUrl: "http://a",
        auth: "basic",
        basicUser: "u",
        basicPass: "p",
      },
      SYSTEM,
    );
    await repository.update(
      record.id,
      { name: "GPU 1", baseUrl: "http://a", auth: "none" },
      record.version,
      SYSTEM,
    );
    const creds = await repository.decryptedCredentials(record.id);
    expect(creds).toBeNull();

    const entries = await auditEntriesFor(db, record.id);
    const updateEntry = entries.find((e) => e.action === "update");
    expect((updateEntry?.after as { credentials: string })?.credentials).toBe(
      "cleared",
    );
  });

  test("a stale version on update is rejected", async () => {
    const repository = await repo();
    const record = await repository.create(
      { name: "GPU 1", baseUrl: "http://a", auth: "none" },
      SYSTEM,
    );
    await repository.update(
      record.id,
      { name: "renamed once", baseUrl: "http://a", auth: "none" },
      record.version,
      SYSTEM,
    );

    await expect(
      repository.update(
        record.id,
        { name: "renamed twice", baseUrl: "http://a", auth: "none" },
        record.version,
        SYSTEM,
      ),
    ).rejects.toThrow(StaleVersion);
  });

  test("soft-delete hides the Backend from list/get but keeps the row and writes an audit entry", async () => {
    const { db } = await testDb;
    const repository = await repo();
    const record = await repository.create(
      { name: "GPU 1", baseUrl: "http://a", auth: "none" },
      SYSTEM,
    );
    await repository.softDelete(record.id, record.version, SYSTEM);

    expect(await repository.get(record.id)).toBeNull();
    expect(await repository.list()).toEqual([]);

    const entries = await auditEntriesFor(db, record.id);
    const deleteEntry = entries.find((e) => e.action === "soft_delete");
    expect(deleteEntry?.after).toBeNull();
  });

  test("soft-deleting an unknown Backend throws NotFound", async () => {
    const repository = await repo();
    await expect(
      repository.softDelete("00000000-0000-0000-0000-000000000000", 1, SYSTEM),
    ).rejects.toThrow(NotFound);
  });

  test("a soft-deleted name can be reused", async () => {
    const repository = await repo();
    const record = await repository.create(
      { name: "GPU 1", baseUrl: "http://a", auth: "none" },
      SYSTEM,
    );
    await repository.softDelete(record.id, record.version, SYSTEM);
    const reused = await repository.create(
      { name: "GPU 1", baseUrl: "http://b", auth: "none" },
      SYSTEM,
    );
    expect(reused.name).toBe("GPU 1");
  });
});
