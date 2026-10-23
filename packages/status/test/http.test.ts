import { describe, expect, test } from "bun:test";
import { fakeClock } from "../src/clock";
import { createStatusApp } from "../src/http";
import { ProblemsTracker } from "../src/tracker";

function appWith(opts: {
  tracker?: ProblemsTracker;
  statusToken?: string;
  admin?: boolean;
  paused?: boolean;
}) {
  const tracker = opts.tracker ?? new ProblemsTracker(fakeClock());
  return createStatusApp({
    tracker,
    statusToken: opts.statusToken,
    isAdminSession: () => opts.admin ?? false,
    isPaused: () => opts.paused ?? false,
  });
}

describe("GET /api/status", () => {
  test("401s with neither an Admin session nor a matching Bearer token", async () => {
    const app = appWith({ statusToken: "secret" });
    const res = await app.request("/api/status");
    expect(res.status).toBe(401);
  });

  test("401s with a wrong Bearer token", async () => {
    const app = appWith({ statusToken: "secret" });
    const res = await app.request("/api/status", {
      headers: { Authorization: "Bearer wrong" },
    });
    expect(res.status).toBe(401);
  });

  test("200s with no Problems, authorized by the Bearer token", async () => {
    const app = appWith({ statusToken: "secret" });
    const res = await app.request("/api/status", {
      headers: { Authorization: "Bearer secret" },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ problems: [] });
  });

  test("200s with no Problems, authorized by an Admin session", async () => {
    const app = appWith({ admin: true });
    const res = await app.request("/api/status");
    expect(res.status).toBe(200);
  });

  test("503s and lists each Problem's code, message, target and since", async () => {
    const tracker = new ProblemsTracker(fakeClock());
    tracker.report("disk_low", "/data", true, "12 GB free");
    const app = appWith({ tracker, admin: true });

    const res = await app.request("/api/status");
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.problems).toEqual([
      {
        code: "disk_low",
        message: "12 GB free",
        target: "/data",
        since: "2026-01-01T00:00:00.000Z",
      },
    ]);
  });

  test("suppresses db_unreachable while Paused, so it can 200 during a Pause", async () => {
    const tracker = new ProblemsTracker(fakeClock());
    tracker.report("db_unreachable", "primary", true, "down");
    const app = appWith({ tracker, admin: true, paused: true });

    const res = await app.request("/api/status");
    expect(res.status).toBe(200);
  });
});
