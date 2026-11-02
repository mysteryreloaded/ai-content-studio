import { test } from "bun:test";
import { hc } from "hono/client";
import type { AppType } from "./app.js";

// Type-only test (issue #171): the admin generations, audit and logs route
// files converted to the chained style (issue #164) expose their `:id`
// params and the `/:id/remove` JSON body to the typed `hc` client. `hc`
// performs its fetch the moment a method is called, so nothing below is
// ever *invoked* at runtime: only the type-level assertions are checked,
// by `bun run typecheck`.
const client = hc<AppType>("http://x");
const ID = "00000000-0000-0000-0000-000000000000";

async function typedCalls() {
  // Generations: list, the jump-to resolve, the detail and history read
  // their `:id` from the path; `/:id/remove` takes the shared schema.
  await client.api.admin.generations.$get();
  await client.api.admin.generations.resolve[":id"].$get({
    param: { id: ID },
  });
  await client.api.admin.generations[":id"].$get({ param: { id: ID } });
  await client.api.admin.generations[":id"].history.$get({
    param: { id: ID },
  });
  await client.api.admin.generations[":id"].remove.$post({
    param: { id: ID },
    json: { reason: "removed by admin" },
  });

  // Audit and logs: the list and 24h-count routes take no typed body.
  await client.api.admin.audit.$get();
  await client.api.admin.logs.$get();
  await client.api.admin.logs["error-count-24h"].$get();

  // Wrong field types are type errors: the client knows each route's
  // `:id` param and the remove body's shape.
  await client.api.admin.generations.resolve[":id"].$get({
    // @ts-expect-error `id` must be a string
    param: { id: 42 },
  });
  await client.api.admin.generations[":id"].$get({
    // @ts-expect-error `id` must be a string
    param: { id: 42 },
  });
  await client.api.admin.generations[":id"].history.$get({
    // @ts-expect-error `id` must be a string
    param: { id: 42 },
  });
  await client.api.admin.generations[":id"].remove.$post({
    // @ts-expect-error `id` must be a string
    param: { id: 42 },
    json: { reason: "removed by admin" },
  });
  await client.api.admin.generations[":id"].remove.$post({
    param: { id: ID },
    // @ts-expect-error `reason` must be a string
    json: { reason: 42 },
  });
  await client.api.admin.generations[":id"].remove.$post({
    param: { id: ID },
    // @ts-expect-error `reason` is required
    json: { bogus: "not the schema" },
  });
}

void typedCalls;

test("hc<AppType> types the converted admin generations, audit and logs routes", () => {
  // Runtime side is intentionally empty: every assertion above is a type.
});
