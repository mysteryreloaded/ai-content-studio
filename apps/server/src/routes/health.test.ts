import { afterAll, describe, expect, test } from "bun:test";
import { FakeClock } from "@ai-content-studio/shared";
import type postgres from "postgres";
import { createTestDatabase } from "../test/database.js";
import { healthRoute } from "./health.js";

describe("/healthz", () => {
  const testDb = createTestDatabase("health_route_test");

  afterAll(async () => {
    await (await testDb).close();
  });

  test("returns 200 ok when the database answers", async () => {
    const { sql } = await testDb;
    const app = healthRoute(sql, new FakeClock());

    const res = await app.request("/");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  test("returns 503 db_unreachable when the query never answers in time", async () => {
    const clock = new FakeClock();
    const neverRespondingSql = (() =>
      new Promise(() => {})) as unknown as postgres.Sql;
    const app = healthRoute(neverRespondingSql, clock);

    const resPromise = app.request("/");
    clock.advance(2_000);
    const res = await resPromise;

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ status: "db_unreachable" });
  });
});
