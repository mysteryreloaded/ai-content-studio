import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { hc } from "hono/client";
import { z } from "zod";
import type { AppEnv } from "./app-env.js";
import { validate } from "./validate.js";

// One POST route wired through validate(), exactly as a converted route
// uses it (issue #164): the route's own error response on a bad body,
// the parsed value from c.req.valid on success.
const route = new Hono<AppEnv>().post(
  "/",
  validate("json", z.object({ name: z.string() }), (c) =>
    c.json({ error: "bad_body" }, 400),
  ),
  (c) => c.json({ name: c.req.valid("json").name }),
);

// Type-level assertion (checked by `bun run typecheck`; the client is
// never called at runtime because hc fetches at call time): the hc
// client's $post (hc maps the bare "/" path to its `index` key) takes
// the validated json body with the schema's types.
const client = hc<typeof route>("http://x");
type Expect<T extends true> = T;
type _PostTakesJson = Expect<
  { json: { name: string } } extends Parameters<
    (typeof client)["index"]["$post"]
  >[0]
    ? true
    : false
>;

describe("auth/validate (issue #164)", () => {
  test("a bad body answers with the route's own 400 response", async () => {
    const res = await route.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: 42 }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "bad_body" });
  });

  test("a good body is parsed and echoed", async () => {
    const res = await route.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "alice" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ name: "alice" });
  });
});
