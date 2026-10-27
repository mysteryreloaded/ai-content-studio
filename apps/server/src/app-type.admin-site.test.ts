import { test } from "bun:test";
import { hc } from "hono/client";
import type { AppType } from "./app.js";

// Type-only test (issue #169): the three admin route files converted to the
// chained style (issue #164) expose their JSON bodies and `:id` params to
// the typed `hc` client. `hc` performs its fetch the moment a method is
// called, so nothing below is ever *invoked* at runtime: only the
// type-level assertions are checked, by `bun run typecheck`.
const client = hc<AppType>("http://x");

// `revision` and `version` are `z.coerce.number()`, whose *input* type is
// `unknown`, so a wrong value for them is not a type error. The
// `@ts-expect-error` cases below target the real field types instead.
async function typedCalls() {
  // Site settings: GET /, the multipart PUT / and pause/resume take no
  // typed body; the five JSON sub-routes take `revision` plus their fields.
  await client.api.admin["site-settings"].$get();
  await client.api.admin["site-settings"].$put();
  await client.api.admin["site-settings"].terms.$put({
    json: { revision: 1, body: "terms", askAgain: true },
  });
  await client.api.admin["site-settings"].privacy.$put({
    json: { revision: 1, body: "privacy" },
  });
  await client.api.admin["site-settings"]["blocked-words"].$put({
    json: { revision: 1, text: "spams, crypto" },
  });
  await client.api.admin["site-settings"].notice.$put({
    json: { revision: 1, text: "notice" },
  });
  await client.api.admin["site-settings"].caps.$put({
    json: { revision: 1, dailyCap: 100, concurrentCap: 10 },
  });
  await client.api.admin["site-settings"].pause.$post();
  await client.api.admin["site-settings"].resume.$post();

  // Backends: POST / and PUT /:id take the shared input schema (PUT adds
  // `version`); the remaining routes read their bodies in-handler.
  await client.api.admin.backends.$get();
  await client.api.admin.backends.$post({
    json: { name: "b", baseUrl: "https://b", auth: "none" },
  });
  await client.api.admin.backends[":id"].$get({ param: { id: "u" } });
  await client.api.admin.backends[":id"].$put({
    param: { id: "u" },
    json: { version: 1, name: "b", baseUrl: "https://b", auth: "none" },
  });
  await client.api.admin.backends[":id"].$delete({ param: { id: "u" } });
  await client.api.admin.backends[":id"].enabled.$patch({
    param: { id: "u" },
  });
  await client.api.admin.backends[":id"].draining.$patch({
    param: { id: "u" },
  });
  await client.api.admin.backends[":id"].history.$get({ param: { id: "u" } });

  // Blocked accounts: list and clear.
  await client.api.admin["blocked-accounts"].$get();
  await client.api.admin["blocked-accounts"][":id"].$delete({
    param: { id: "u" },
  });

  // Wrong field types are type errors: the client knows each body's shape.
  await client.api.admin["site-settings"].terms.$put({
    // @ts-expect-error `body` must be a string
    json: { revision: 1, body: 42, askAgain: true },
  });
  await client.api.admin["site-settings"].terms.$put({
    // @ts-expect-error `askAgain` must be a boolean
    json: { revision: 1, body: "terms", askAgain: "yes" },
  });
  await client.api.admin["site-settings"].privacy.$put({
    // @ts-expect-error `body` must be a string
    json: { revision: 1, body: 42 },
  });
  await client.api.admin["site-settings"]["blocked-words"].$put({
    // @ts-expect-error `text` must be a string
    json: { revision: 1, text: 42 },
  });
  await client.api.admin["site-settings"].notice.$put({
    // @ts-expect-error `text` must be a string
    json: { revision: 1, text: 42 },
  });
  await client.api.admin["site-settings"].caps.$put({
    // @ts-expect-error `dailyCap` must be a number
    json: { revision: 1, dailyCap: "a lot", concurrentCap: 10 },
  });
  await client.api.admin.backends.$post({
    // @ts-expect-error `auth` must be "none" | "basic" | "header"
    json: { name: "b", baseUrl: "https://b", auth: "oauth" },
  });
  await client.api.admin.backends[":id"].$put({
    param: { id: "u" },
    // @ts-expect-error `name` must be a string
    json: { version: 1, name: 42, baseUrl: "https://b", auth: "none" },
  });
  // @ts-expect-error `id` must be a string
  await client.api.admin.backends[":id"].$get({ param: { id: 42 } });
  await client.api.admin.backends[":id"].enabled.$patch({
    param: { id: "u" },
    // @ts-expect-error this route takes no JSON body
    json: { version: 1, enabled: true },
  });
  await client.api.admin["blocked-accounts"][":id"].$delete({
    // @ts-expect-error `id` must be a string
    param: { id: 42 },
  });
}

void typedCalls;

test("hc<AppType> types the converted admin routes", () => {
  // Runtime side is intentionally empty: every assertion above is a type.
});
