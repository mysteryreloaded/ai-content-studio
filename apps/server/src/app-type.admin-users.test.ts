import { test } from "bun:test";
import { hc } from "hono/client";
import type { AppType } from "./app.js";

// Type-only test (issue #170): the admin Users, admin Uploads and auth
// route files converted to the chained style (issue #164) expose their
// `:id` params and validated JSON bodies to the typed `hc` client. The
// auth routes only needed chaining (they take no JSON body or path
// param — just query params and cookies), so for them only a plain
// call per route. `hc` performs its fetch the moment a method is
// called, so nothing below is ever *invoked* at runtime: only the
// type-level assertions are checked, by `bun run typecheck`.
const client = hc<AppType>("http://x");

async function typedCalls() {
  // Auth: Google sign-in, its callback, sign-out and the current user.
  await client.api.auth.google.$get();
  await client.api.auth.google.callback.$get();
  await client.api.auth.signout.$post();
  await client.api.auth.me.$get();

  // Admin users: the user page and its actions. approve/promote/
  // demote/enable take only the `:id` param — no body; disable and
  // delete take an optional `reason`; caps takes the two nullable
  // override fields.
  await client.api.admin.users[":id"].$get({ param: { id: "u" } });
  await client.api.admin.users[":id"].approve.$post({ param: { id: "u" } });
  await client.api.admin.users[":id"].promote.$post({ param: { id: "u" } });
  await client.api.admin.users[":id"].demote.$post({ param: { id: "u" } });
  await client.api.admin.users[":id"].enable.$post({ param: { id: "u" } });
  await client.api.admin.users[":id"].disable.$post({
    param: { id: "u" },
    json: { reason: "spam" },
  });
  await client.api.admin.users[":id"].disable.$post({
    param: { id: "u" },
    json: {},
  });
  await client.api.admin.users[":id"].caps.$put({
    param: { id: "u" },
    json: { dailyCapOverride: 10, concurrentCapOverride: null },
  });
  await client.api.admin.users[":id"].$delete({
    param: { id: "u" },
    json: { reason: "abandoned" },
  });
  await client.api.admin.users[":id"].$delete({
    param: { id: "u" },
    json: {},
  });

  // Admin uploads: Remove takes the `:id` param and a required reason.
  await client.api.admin.uploads[":id"].remove.$post({
    param: { id: "u" },
    json: { reason: "duplicate" },
  });

  // Wrong inputs are type errors: the client knows each param and
  // body. `:id` is a string, `reason` a string, and the cap overrides
  // a number or null.
  await client.api.admin.users[":id"].$get({
    // @ts-expect-error `id` must be a string
    param: { id: 42 },
  });
  await client.api.admin.users[":id"].approve.$post({
    // @ts-expect-error `id` must be a string
    param: { id: 42 },
  });
  await client.api.admin.users[":id"].promote.$post({
    // @ts-expect-error `id` must be a string
    param: { id: 42 },
  });
  await client.api.admin.users[":id"].demote.$post({
    // @ts-expect-error `id` must be a string
    param: { id: 42 },
  });
  await client.api.admin.users[":id"].enable.$post({
    // @ts-expect-error `id` must be a string
    param: { id: 42 },
  });
  await client.api.admin.users[":id"].disable.$post({
    // @ts-expect-error `id` must be a string
    param: { id: 42 },
    // @ts-expect-error `reason` must be a string
    json: { reason: 42 },
  });
  await client.api.admin.users[":id"].caps.$put({
    // @ts-expect-error `id` must be a string
    param: { id: 42 },
    // @ts-expect-error `dailyCapOverride` must be a number or null
    json: { dailyCapOverride: "a lot", concurrentCapOverride: null },
  });
  await client.api.admin.users[":id"].$delete({
    // @ts-expect-error `id` must be a string
    param: { id: 42 },
    // @ts-expect-error `reason` must be a string
    json: { reason: 42 },
  });
  await client.api.admin.uploads[":id"].remove.$post({
    // @ts-expect-error `id` must be a string
    param: { id: 42 },
    // @ts-expect-error `reason` must be a string
    json: { reason: 42 },
  });
  await client.api.admin.uploads[":id"].remove.$post({
    param: { id: "u" },
    // @ts-expect-error `reason` is required
    json: {},
  });
}

void typedCalls;

test("hc<AppType> types the converted users, uploads and auth routes", () => {
  // Runtime side is intentionally empty: every assertion above is a type.
});
