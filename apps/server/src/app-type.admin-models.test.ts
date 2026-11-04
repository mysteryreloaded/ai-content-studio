import { test } from "bun:test";
import { hc } from "hono/client";
import type { AppType } from "./app.js";

// Type-only test (issue #168): the admin Models routes converted to the
// chained style (issue #164) expose their JSON bodies and `:id` params to
// the typed `hc` client. `hc` performs its fetch the moment a method is
// called, so nothing below is ever *invoked* at runtime: only the
// type-level assertions are checked, by `bun run typecheck`.
const client = hc<AppType>("http://x");

// The gate schemas' `version`/`revision` are `z.coerce.number()`, whose
// *input* type is `unknown`, so a wrong value for one of them is not a
// type error. The `@ts-expect-error` cases below target the real field
// types instead (and, for the version-only routes, the exact
// `{ version }` shape, which `disable` is not part of).
async function typedCalls() {
  // List: GET / carries each row's queue/Backend figures (issue #204),
  // reused from `/api/admin/overview` (issue #203).
  const listRes = await client.api.admin.models.$get();
  const { models: modelsList } = await listRes.json();
  const [row] = modelsList;
  const modeCount: number | undefined = row?.modeCount;
  const backendFigures: { usable: number; attached: number } | undefined =
    row?.backends;
  const modesWithoutBackend: string[] | undefined = row?.modesWithoutBackend;
  const queued: number | undefined = row?.queued;
  const running: number | undefined = row?.running;
  void [modeCount, backendFigures, modesWithoutBackend, queued, running];

  // Model create: POST / takes the create schema (`name` plus the raw
  // workflow).
  await client.api.admin.models.$post({
    json: { name: "m", workflow: {} },
  });

  // Inputs update: PUT /:id/inputs takes the inputs schema (`version`
  // plus the whole Inputs list, and optionally `disable`).
  await client.api.admin.models[":id"].inputs.$put({
    param: { id: "u" },
    json: { version: 1, inputs: [] },
  });

  // Modes update: PUT /:id/modes takes the modes schema.
  await client.api.admin.models[":id"].modes.$put({
    param: { id: "u" },
    json: { version: 1, modes: [] },
  });

  // Enable: POST /:id/enable's gate body is exactly `{ version }`.
  await client.api.admin.models[":id"].enable.$post({
    param: { id: "u" },
    json: { version: 1 },
  });

  // Draft save: PUT /:id/draft (issue #218) takes the whole editor
  // draft — Details, Terms, an optional re-uploaded Workflow, Inputs
  // and Modes — in one body.
  await client.api.admin.models[":id"].draft.$put({
    param: { id: "u" },
    json: {
      version: 1,
      details: { name: "m", slug: "m", description: "", maxRunTimeMinutes: 30 },
      terms: {
        termsBody: "",
        licenseUrl: "",
        attribution: "",
        askAgain: false,
      },
      inputs: [],
      modes: [],
      disable: false,
    },
  });

  // Object info: GET /:id/object-info (issue #220) carries `others` —
  // every enabled, unattached Backend's node knowledge, same shape as
  // the attached `backends` entries.
  const objectInfoRes = await client.api.admin.models[":id"][
    "object-info"
  ].$get({ param: { id: "u" } });
  if (objectInfoRes.ok) {
    const { backends: objectInfoBackends, others } = await objectInfoRes.json();
    const [otherBackend] = others;
    const otherNodeTypes: string[] | undefined = otherBackend?.nodeTypes;
    const otherReachable: boolean | undefined = otherBackend?.reachable;
    void [objectInfoBackends, otherNodeTypes, otherReachable];
  }

  // Wrong field types are type errors: the client knows each body's shape.
  await client.api.admin.models.$post({
    // @ts-expect-error `name` must be a string
    json: { name: 42, workflow: {} },
  });
  await client.api.admin.models[":id"].inputs.$put({
    param: { id: "u" },
    // @ts-expect-error `disable` must be a boolean
    json: { version: 1, inputs: [], disable: "yes" },
  });
  await client.api.admin.models[":id"].modes.$put({
    param: { id: "u" },
    // @ts-expect-error `disable` must be a boolean
    json: { version: 1, modes: [], disable: "yes" },
  });
  await client.api.admin.models[":id"].enable.$post({
    param: { id: "u" },
    // @ts-expect-error the gate body is exactly `{ version }`
    json: { version: 1, disable: true },
  });
  await client.api.admin.models[":id"].enable.$post({
    param: { id: "u" },
    // @ts-expect-error the body must be an object
    json: "not an object",
  });
  await client.api.admin.models[":id"].draft.$put({
    param: { id: "u" },
    json: {
      version: 1,
      details: { name: "m", slug: "m", description: "", maxRunTimeMinutes: 30 },
      terms: {
        termsBody: "",
        licenseUrl: "",
        attribution: "",
        askAgain: false,
      },
      inputs: [],
      modes: [],
      // @ts-expect-error `disable` must be a boolean
      disable: "yes",
    },
  });
}

void typedCalls;

test("hc<AppType> types the admin Models routes", () => {
  // Runtime side is intentionally empty: every assertion above is a type.
});
