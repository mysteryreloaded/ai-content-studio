// End-to-end: a real fake-comfyui HTTP server standing in for several
// Backends, polled by the real client + monitor (issue #39).

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import postgres from "postgres";
import { startFakeComfyUi } from "../../../apps/fake-comfyui/src/server";
import { backendTarget } from "../src/client";
import { fakeClock } from "../src/clock";
import { runMigrations } from "../src/db/pool";
import { createLogger } from "../src/logger";
import { BackendMonitor } from "../src/monitor";
import { BackendRepository } from "../src/repository";

const CONNECTION_STRING = process.env.TEST_DATABASE_URL ?? "postgres://postgres:test@localhost:55432/backends_test";
const SECRET_KEY = randomBytes(32).toString("base64");

let sql: postgres.Sql;

beforeAll(async () => {
  sql = postgres(CONNECTION_STRING);
  await runMigrations(sql);
});

afterAll(async () => {
  await sql.end();
});

beforeEach(async () => {
  await sql`truncate backends, log_entries, audit_entries restart identity cascade`;
});

describe("Backend monitor against a fake ComfyUI", () => {
  test("reports health, version and VRAM, then unreachable, then reachable again", async () => {
    const fake = startFakeComfyUi({ port: 0, comfyuiVersion: "0.3.5", vramTotal: 100, vramFree: 90 });
    try {
      const repo = new BackendRepository(sql, SECRET_KEY);
      const backend = await repo.create({ name: "Fake 1", baseUrl: fake.url, auth: "none" }, "system");

      const clock = fakeClock();
      const logger = createLogger(sql, clock);
      const monitor = new BackendMonitor(clock, logger);
      const target = backendTarget(backend, repo);
      monitor.watch(target);

      await monitor.poll(target);
      expect(monitor.healthFor(backend.id)).toMatchObject({
        reachability: "reachable",
        comfyuiVersion: "0.3.5",
        vramTotal: 100,
        vramFree: 90,
      });

      fake.setUnreachable(true);
      await monitor.poll(target);
      await monitor.poll(target);
      await monitor.poll(target);
      expect(monitor.healthFor(backend.id).reachability).toBe("unreachable");

      const [warning] = await sql`select * from log_entries where level = 'warning'`;
      expect(warning.message).toContain("became unreachable");

      fake.setUnreachable(false);
      await monitor.poll(target);
      expect(monitor.healthFor(backend.id).reachability).toBe("reachable");

      const [info] = await sql`select * from log_entries where level = 'info'`;
      expect(info.message).toContain("reachable again");
    } finally {
      fake.stop();
    }
  });

  test("several fake instances act as several Backends", async () => {
    const fakeA = startFakeComfyUi({ port: 0, comfyuiVersion: "0.3.0" });
    const fakeB = startFakeComfyUi({ port: 0, comfyuiVersion: "0.3.1" });
    try {
      const repo = new BackendRepository(sql, SECRET_KEY);
      const a = await repo.create({ name: "A", baseUrl: fakeA.url, auth: "none" }, "system");
      const b = await repo.create({ name: "B", baseUrl: fakeB.url, auth: "none" }, "system");

      const clock = fakeClock();
      const logger = createLogger(sql, clock);
      const monitor = new BackendMonitor(clock, logger);
      const targetA = backendTarget(a, repo);
      const targetB = backendTarget(b, repo);
      monitor.watch(targetA);
      monitor.watch(targetB);

      await monitor.poll(targetA);
      await monitor.poll(targetB);

      expect(monitor.healthFor(a.id).comfyuiVersion).toBe("0.3.0");
      expect(monitor.healthFor(b.id).comfyuiVersion).toBe("0.3.1");
    } finally {
      fakeA.stop();
      fakeB.stop();
    }
  });

  test("basic auth is required and sent correctly", async () => {
    const fake = startFakeComfyUi({ port: 0, basicAuth: { user: "admin", pass: "secret" } });
    try {
      const repo = new BackendRepository(sql, SECRET_KEY);
      const backend = await repo.create(
        { name: "Auth'd", baseUrl: fake.url, auth: "basic", basicUser: "admin", basicPass: "secret" },
        "system",
      );

      const clock = fakeClock();
      const logger = createLogger(sql, clock);
      const monitor = new BackendMonitor(clock, logger);
      const target = backendTarget(backend, repo);
      monitor.watch(target);

      await monitor.poll(target);
      expect(monitor.healthFor(backend.id).reachability).toBe("reachable");
    } finally {
      fake.stop();
    }
  });

  test("wrong credentials fail to reach the Backend", async () => {
    const fake = startFakeComfyUi({ port: 0, basicAuth: { user: "admin", pass: "secret" } });
    try {
      const repo = new BackendRepository(sql, SECRET_KEY);
      const backend = await repo.create(
        { name: "Auth'd", baseUrl: fake.url, auth: "basic", basicUser: "admin", basicPass: "wrong" },
        "system",
      );

      const clock = fakeClock();
      const logger = createLogger(sql, clock);
      const monitor = new BackendMonitor(clock, logger);
      const target = backendTarget(backend, repo);
      monitor.watch(target);

      await monitor.poll(target);
      await monitor.poll(target);
      await monitor.poll(target);
      expect(monitor.healthFor(backend.id).reachability).toBe("unreachable");
    } finally {
      fake.stop();
    }
  });
});
