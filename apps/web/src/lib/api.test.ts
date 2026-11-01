import { describe, expect, test } from "bun:test";

import { ApiError, api, ok } from "./api.js";

describe("the hc client", () => {
  test("exposes the server's mounted routes at runtime", () => {
    // authRoute's erased `: Hono<AppEnv>` return annotation drops
    // `me`/`signout` from the *type* (issue #170 owns that conversion),
    // but the routes are mounted at runtime — the cast in `useSession`
    // relies on exactly this.
    const auth = api.api.auth as unknown as {
      me: { $get: unknown };
      signout: { $post: unknown };
    };
    expect(typeof auth.me.$get).toBe("function");
    expect(typeof auth.signout.$post).toBe("function");
  });
});

describe("ok", () => {
  test("resolves with the parsed JSON body on success", async () => {
    expect(await ok(Response.json({ hello: "world" }))).toEqual({
      hello: "world",
    });
  });

  test("resolves with null when the success body is not JSON", async () => {
    expect(await ok(new Response(null, { status: 204 }))).toBeNull();
  });

  test("throws an ApiError with the status and the parsed body on failure", async () => {
    const error = (await ok(
      Response.json({ error: "invalid input" }, { status: 400 }),
    ).catch((e: unknown) => e)) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.name).toBe("ApiError");
    expect(error.status).toBe(400);
    expect(error.body).toEqual({ error: "invalid input" });
  });

  test("carries a null body when the failure body is not JSON", async () => {
    const error = (await ok(new Response(null, { status: 500 })).catch(
      (e: unknown) => e,
    )) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(500);
    expect(error.body).toBeNull();
  });

  test("accepts hc's ClientResponse shape, not just a fetch Response", async () => {
    // hono's ClientResponse is a distinct structural type, not a
    // Response: `ok`'s parameter is the minimal shape both satisfy.
    const error = (await ok({
      ok: false,
      status: 404,
      json: async () => ({ error: "not found" }),
    }).catch((e: unknown) => e)) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(404);
    expect(error.body).toEqual({ error: "not found" });
  });

  test("awaits a promise of a response", async () => {
    const body = await ok(
      Promise.resolve(Response.json({ a: 1 }, { status: 200 })),
    );
    expect(body).toEqual({ a: 1 });
  });
});
