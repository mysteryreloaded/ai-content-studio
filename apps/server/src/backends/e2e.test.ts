// End-to-end: a real fake-comfyui HTTP server standing in for several
// Backends, polled by the real client + monitor (issue #39).

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { startFakeComfyUi } from "@ai-content-studio/fake-comfyui";
import { FakeClock } from "@ai-content-studio/shared";
import type { AuditActor } from "../audit/audit.js";
import { backends, logEntries } from "../db/schema.js";
import { createTestDatabase } from "../test/database.js";
import { backendTarget } from "./client.js";
import { createLogEntryWriter } from "./log-entries.js";
import { BackendMonitor } from "./monitor.js";
import { BackendRepository } from "./repository.js";

const SECRET_KEY = randomBytes(32).toString("base64");
const SYSTEM: AuditActor = { type: "system" };

function silentLogger() {
  return { debug() {}, info() {}, warn() {}, error() {} };
}

describe("Backend monitor against a fake ComfyUI", () => {
  const testDb = createTestDatabase("backends_e2e_test");

  afterAll(async () => {
    await (await testDb).close();
  });

  beforeEach(async () => {
    const { db } = await testDb;
    await db.delete(logEntries);
    await db.delete(backends);
  });

  test("reports health, version and VRAM, then unreachable, then reachable again", async () => {
    const { db } = await testDb;
    const fake = startFakeComfyUi({
      port: 0,
      comfyuiVersion: "0.3.5",
      vramTotal: 100,
      vramFree: 90,
    });
    try {
      const repository = new BackendRepository(db, new FakeClock(), SECRET_KEY);
      const backend = await repository.create(
        { name: "Fake 1", baseUrl: fake.url, auth: "none" },
        SYSTEM,
      );

      const clock = new FakeClock();
      const logger = createLogEntryWriter(db, clock, silentLogger());
      const monitor = new BackendMonitor(clock, logger);
      const target = backendTarget(backend, repository);
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

      const warningRows = (await db.select().from(logEntries)).filter(
        (r) => r.level === "warning",
      );
      expect(warningRows[0]?.message).toContain("became unreachable");

      fake.setUnreachable(false);
      await monitor.poll(target);
      expect(monitor.healthFor(backend.id).reachability).toBe("reachable");

      const infoRows = (await db.select().from(logEntries)).filter(
        (r) => r.level === "info",
      );
      expect(infoRows[0]?.message).toContain("reachable again");
    } finally {
      fake.stop();
    }
  });

  test("several fake instances act as several Backends", async () => {
    const { db } = await testDb;
    const fakeA = startFakeComfyUi({ port: 0, comfyuiVersion: "0.3.0" });
    const fakeB = startFakeComfyUi({ port: 0, comfyuiVersion: "0.3.1" });
    try {
      const repository = new BackendRepository(db, new FakeClock(), SECRET_KEY);
      const a = await repository.create(
        { name: "A", baseUrl: fakeA.url, auth: "none" },
        SYSTEM,
      );
      const b = await repository.create(
        { name: "B", baseUrl: fakeB.url, auth: "none" },
        SYSTEM,
      );

      const clock = new FakeClock();
      const logger = createLogEntryWriter(db, clock, silentLogger());
      const monitor = new BackendMonitor(clock, logger);
      const targetA = backendTarget(a, repository);
      const targetB = backendTarget(b, repository);
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
    const { db } = await testDb;
    const fake = startFakeComfyUi({
      port: 0,
      basicAuth: { user: "admin", pass: "secret" },
    });
    try {
      const repository = new BackendRepository(db, new FakeClock(), SECRET_KEY);
      const backend = await repository.create(
        {
          name: "Auth'd",
          baseUrl: fake.url,
          auth: "basic",
          basicUser: "admin",
          basicPass: "secret",
        },
        SYSTEM,
      );

      const clock = new FakeClock();
      const logger = createLogEntryWriter(db, clock, silentLogger());
      const monitor = new BackendMonitor(clock, logger);
      const target = backendTarget(backend, repository);
      monitor.watch(target);

      await monitor.poll(target);
      expect(monitor.healthFor(backend.id).reachability).toBe("reachable");
    } finally {
      fake.stop();
    }
  });

  test("wrong credentials fail to reach the Backend", async () => {
    const { db } = await testDb;
    const fake = startFakeComfyUi({
      port: 0,
      basicAuth: { user: "admin", pass: "secret" },
    });
    try {
      const repository = new BackendRepository(db, new FakeClock(), SECRET_KEY);
      const backend = await repository.create(
        {
          name: "Auth'd",
          baseUrl: fake.url,
          auth: "basic",
          basicUser: "admin",
          basicPass: "wrong",
        },
        SYSTEM,
      );

      const clock = new FakeClock();
      const logger = createLogEntryWriter(db, clock, silentLogger());
      const monitor = new BackendMonitor(clock, logger);
      const target = backendTarget(backend, repository);
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
