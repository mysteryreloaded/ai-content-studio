import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import postgres from "postgres";
import { createBackendsHandler } from "../src/http";
import { fakeClock } from "../src/clock";
import { runMigrations } from "../src/db/pool";
import { createLogger } from "../src/logger";
import { BackendRepository } from "../src/repository";
import { BackendsService } from "../src/service";

const CONNECTION_STRING = process.env.TEST_DATABASE_URL ?? "postgres://postgres:test@localhost:55432/backends_test";
const SECRET_KEY = randomBytes(32).toString("base64");

let sql: postgres.Sql;
let handler: (req: Request) => Promise<Response>;

beforeAll(async () => {
  sql = postgres(CONNECTION_STRING);
  await runMigrations(sql);
});

afterAll(async () => {
  await sql.end();
});

beforeEach(async () => {
  await sql`truncate backends, log_entries, audit_entries restart identity cascade`;
  const repository = new BackendRepository(sql, SECRET_KEY);
  const clock = fakeClock();
  const logger = createLogger(sql, clock);
  const service = new BackendsService(repository, clock, logger, false);
  handler = createBackendsHandler({ repository, service, sql });
});

describe("Backends HTTP handler", () => {
  test("POST /backends creates one, GET /backends lists it", async () => {
    const createRes = await handler(
      new Request("http://x/backends", {
        method: "POST",
        body: JSON.stringify({ name: "GPU 1", baseUrl: "http://a", auth: "none" }),
      }),
    );
    expect(createRes.status).toBe(201);
    const created = await createRes.json();

    const listRes = await handler(new Request("http://x/backends"));
    const list = await listRes.json();
    expect(list.backends).toHaveLength(1);
    expect(list.backends[0].id).toBe(created.id);
    expect(list.disabledBanner).toContain("BACKENDS_ENABLED=false");
  });

  test("invalid input returns 400", async () => {
    const res = await handler(
      new Request("http://x/backends", {
        method: "POST",
        body: JSON.stringify({ name: "", baseUrl: "http://a", auth: "none" }),
      }),
    );
    expect(res.status).toBe(400);
  });

  test("a stale PUT returns 409", async () => {
    const createRes = await handler(
      new Request("http://x/backends", {
        method: "POST",
        body: JSON.stringify({ name: "GPU 1", baseUrl: "http://a", auth: "none" }),
      }),
    );
    const created = await createRes.json();

    const staleRes = await handler(
      new Request(`http://x/backends/${created.id}`, {
        method: "PUT",
        body: JSON.stringify({ name: "renamed", baseUrl: "http://a", auth: "none", version: created.version + 1 }),
      }),
    );
    expect(staleRes.status).toBe(409);
  });

  test("a duplicate name returns 409", async () => {
    await handler(
      new Request("http://x/backends", {
        method: "POST",
        body: JSON.stringify({ name: "GPU 1", baseUrl: "http://a", auth: "none" }),
      }),
    );
    const res = await handler(
      new Request("http://x/backends", {
        method: "POST",
        body: JSON.stringify({ name: "GPU 1", baseUrl: "http://b", auth: "none" }),
      }),
    );
    expect(res.status).toBe(409);
  });

  test("DELETE soft-deletes, then GET /backends/:id/history shows it", async () => {
    const createRes = await handler(
      new Request("http://x/backends", {
        method: "POST",
        body: JSON.stringify({ name: "GPU 1", baseUrl: "http://a", auth: "none" }),
      }),
    );
    const created = await createRes.json();

    const deleteRes = await handler(
      new Request(`http://x/backends/${created.id}?version=${created.version}`, { method: "DELETE" }),
    );
    expect(deleteRes.status).toBe(204);

    const historyRes = await handler(new Request(`http://x/backends/${created.id}/history`));
    const history = await historyRes.json();
    expect(history.entries.map((e: { action: string }) => e.action)).toEqual(["soft_delete", "create"]);
  });
});
