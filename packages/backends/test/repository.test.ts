import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import postgres from "postgres";
import { runMigrations } from "../src/db/pool";
import { NameTaken, NotFound, StaleVersion } from "../src/repository";
import { BackendRepository } from "../src/repository";
import { ValidationFailed } from "../src/validation";

const CONNECTION_STRING = process.env.TEST_DATABASE_URL ?? "postgres://postgres:test@localhost:55432/backends_test";
const SECRET_KEY = randomBytes(32).toString("base64");
const SYSTEM: "system" = "system";

let sql: postgres.Sql;
let repo: BackendRepository;

beforeAll(async () => {
  sql = postgres(CONNECTION_STRING);
  await runMigrations(sql);
});

afterAll(async () => {
  await sql.end();
});

beforeEach(async () => {
  await sql`truncate backends, log_entries, audit_entries restart identity cascade`;
  repo = new BackendRepository(sql, SECRET_KEY);
});

describe("BackendRepository", () => {
  test("creates a Backend and writes an audit entry for it", async () => {
    const record = await repo.create({ name: "GPU 1", baseUrl: "http://localhost:8188", auth: "none" }, SYSTEM);
    expect(record.name).toBe("GPU 1");
    expect(record.version).toBe(1);

    const [entry] = await sql`select * from audit_entries where target = ${`backend:${record.id}`}`;
    expect(entry.action).toBe("create");
    expect(entry.actor).toBe("system");
    expect(entry.after.credentials).toBe("unchanged");
  });

  test("rejects a duplicate name", async () => {
    await repo.create({ name: "GPU 1", baseUrl: "http://a", auth: "none" }, SYSTEM);
    await expect(repo.create({ name: "GPU 1", baseUrl: "http://b", auth: "none" }, SYSTEM)).rejects.toThrow(
      NameTaken,
    );
  });

  test("rejects invalid input before touching the database", async () => {
    await expect(repo.create({ name: "", baseUrl: "http://a", auth: "none" }, SYSTEM)).rejects.toThrow(
      ValidationFailed,
    );
  });

  test("rejects creating a header-auth Backend with no header name", async () => {
    await expect(
      repo.create({ name: "GPU 1", baseUrl: "http://a", auth: "header", headerValue: "v" }, SYSTEM),
    ).rejects.toThrow(ValidationFailed);

    expect(await repo.list()).toEqual([]);
  });

  test("rejects creating a header-auth Backend with no credential value", async () => {
    await expect(
      repo.create({ name: "GPU 1", baseUrl: "http://a", auth: "header", headerName: "X-Api-Key" }, SYSTEM),
    ).rejects.toThrow(ValidationFailed);
  });

  test("rejects creating a basic-auth Backend with no user/pass", async () => {
    await expect(repo.create({ name: "GPU 1", baseUrl: "http://a", auth: "basic" }, SYSTEM)).rejects.toThrow(
      ValidationFailed,
    );
  });

  test("stores basic credentials encrypted and marks the audit entry 'set'", async () => {
    const record = await repo.create(
      { name: "GPU 1", baseUrl: "http://a", auth: "basic", basicUser: "u", basicPass: "p" },
      SYSTEM,
    );
    const row = await sql`select encrypted_credentials from backends where id = ${record.id}`;
    expect(row[0]?.encrypted_credentials).not.toBeNull();

    const creds = await repo.decryptedCredentials(record.id);
    expect(creds).toEqual({ user: "u", pass: "p" });

    const [entry] = await sql`select * from audit_entries where target = ${`backend:${record.id}`}`;
    expect(entry.after.credentials).toBe("set");
  });

  test("update with a blank credential field keeps the existing credentials", async () => {
    const record = await repo.create(
      { name: "GPU 1", baseUrl: "http://a", auth: "basic", basicUser: "u", basicPass: "p" },
      SYSTEM,
    );
    const updated = await repo.update(
      record.id,
      { name: "GPU 1 renamed", baseUrl: "http://a", auth: "basic" },
      record.version,
      SYSTEM,
    );
    expect(updated.name).toBe("GPU 1 renamed");

    const creds = await repo.decryptedCredentials(record.id);
    expect(creds).toEqual({ user: "u", pass: "p" });

    const [entry] = await sql`
      select * from audit_entries where target = ${`backend:${record.id}`} and action = 'update'
    `;
    expect(entry.after.credentials).toBe("unchanged");
  });

  test("update with new credentials marks the audit entry 'changed'", async () => {
    const record = await repo.create(
      { name: "GPU 1", baseUrl: "http://a", auth: "basic", basicUser: "u", basicPass: "p" },
      SYSTEM,
    );
    await repo.update(
      record.id,
      { name: "GPU 1", baseUrl: "http://a", auth: "basic", basicUser: "u2", basicPass: "p2" },
      record.version,
      SYSTEM,
    );
    const creds = await repo.decryptedCredentials(record.id);
    expect(creds).toEqual({ user: "u2", pass: "p2" });

    const [entry] = await sql`
      select * from audit_entries where target = ${`backend:${record.id}`} and action = 'update'
    `;
    expect(entry.after.credentials).toBe("changed");
  });

  test("switching auth to none clears credentials, marked 'cleared'", async () => {
    const record = await repo.create(
      { name: "GPU 1", baseUrl: "http://a", auth: "basic", basicUser: "u", basicPass: "p" },
      SYSTEM,
    );
    await repo.update(record.id, { name: "GPU 1", baseUrl: "http://a", auth: "none" }, record.version, SYSTEM);
    const creds = await repo.decryptedCredentials(record.id);
    expect(creds).toBeNull();

    const [entry] = await sql`
      select * from audit_entries where target = ${`backend:${record.id}`} and action = 'update'
    `;
    expect(entry.after.credentials).toBe("cleared");
  });

  test("a stale version on update is rejected", async () => {
    const record = await repo.create({ name: "GPU 1", baseUrl: "http://a", auth: "none" }, SYSTEM);
    await repo.update(record.id, { name: "renamed once", baseUrl: "http://a", auth: "none" }, record.version, SYSTEM);

    await expect(
      repo.update(record.id, { name: "renamed twice", baseUrl: "http://a", auth: "none" }, record.version, SYSTEM),
    ).rejects.toThrow(StaleVersion);
  });

  test("soft-delete hides the Backend from list/get but keeps the row and writes an audit entry", async () => {
    const record = await repo.create({ name: "GPU 1", baseUrl: "http://a", auth: "none" }, SYSTEM);
    await repo.softDelete(record.id, record.version, SYSTEM);

    expect(await repo.get(record.id)).toBeNull();
    expect(await repo.list()).toEqual([]);

    const row = await sql`select deleted_at from backends where id = ${record.id}`;
    expect(row[0]?.deleted_at).not.toBeNull();

    const [entry] = await sql`
      select * from audit_entries where target = ${`backend:${record.id}`} and action = 'soft_delete'
    `;
    expect(entry.after).toBeNull();
  });

  test("soft-deleting an unknown Backend throws NotFound", async () => {
    await expect(repo.softDelete("00000000-0000-0000-0000-000000000000", 1, SYSTEM)).rejects.toThrow(NotFound);
  });

  test("a soft-deleted name can be reused", async () => {
    const record = await repo.create({ name: "GPU 1", baseUrl: "http://a", auth: "none" }, SYSTEM);
    await repo.softDelete(record.id, record.version, SYSTEM);
    const reused = await repo.create({ name: "GPU 1", baseUrl: "http://b", auth: "none" }, SYSTEM);
    expect(reused.name).toBe("GPU 1");
  });

  test("audit_entries is append-only: update and delete are rejected by the trigger", async () => {
    const record = await repo.create({ name: "GPU 1", baseUrl: "http://a", auth: "none" }, SYSTEM);
    const [entry] = await sql`select id from audit_entries where target = ${`backend:${record.id}`}`;

    await expect(sql`update audit_entries set action = 'tampered' where id = ${entry.id}`).rejects.toThrow();
    await expect(sql`delete from audit_entries where id = ${entry.id}`).rejects.toThrow();
  });
});
