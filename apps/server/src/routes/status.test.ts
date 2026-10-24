import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import type { AppEnv } from "../auth/app-env.js";
import { ProblemsRegistry } from "../problems/problems.js";
import { statusRoute } from "./status.js";

const ORIGINAL_STATUS_TOKEN = process.env.STATUS_TOKEN;

describe("GET /api/status", () => {
  beforeEach(() => {
    process.env.STATUS_TOKEN = "secret-token";
  });

  afterEach(() => {
    if (ORIGINAL_STATUS_TOKEN === undefined) {
      Reflect.deleteProperty(process.env, "STATUS_TOKEN");
    } else {
      process.env.STATUS_TOKEN = ORIGINAL_STATUS_TOKEN;
    }
  });

  function buildApp(registry: ProblemsRegistry) {
    const app = new Hono<AppEnv>();
    app.route("/api/status", statusRoute(registry, []));
    return app;
  }

  test("answers 200 with no Problems, given the Bearer token", async () => {
    const app = buildApp(new ProblemsRegistry(() => new Date()));
    const res = await app.request("/api/status", {
      headers: { Authorization: "Bearer secret-token" },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  test("answers 503 listing each Problem, given the Bearer token", async () => {
    const registry = new ProblemsRegistry(
      () => new Date("2026-01-01T00:00:00.000Z"),
    );
    registry.set("disk_low", "/data", "Only 1 GB free.");
    const app = buildApp(registry);

    const res = await app.request("/api/status", {
      headers: { Authorization: "Bearer secret-token" },
    });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      status: "problems",
      problems: [
        {
          code: "disk_low",
          message: "Only 1 GB free.",
          target: "/data",
          since: "2026-01-01T00:00:00.000Z",
        },
      ],
    });
  });

  test("refuses a wrong or missing Bearer token without an Admin session", async () => {
    const app = buildApp(new ProblemsRegistry(() => new Date()));

    const noAuth = await app.request("/api/status");
    expect(noAuth.status).toBe(401);

    const wrongAuth = await app.request("/api/status", {
      headers: { Authorization: "Bearer wrong" },
    });
    expect(wrongAuth.status).toBe(401);
  });
});
