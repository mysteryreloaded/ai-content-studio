import { test } from "bun:test";
import { hc } from "hono/client";
import type { AppType } from "./app-type.js";

// Type-only test (issue #166): `models.ts`, `submissions.ts` and
// `gallery.ts` are converted to the chained route style, so the composed
// `api` (and thus `AppType`) carries their full route schema — the path
// params, the submit body validated by `validate("json", ...)`, and each
// handler's response types — instead of a `: Hono<AppEnv>` annotation
// that would have erased it. The typed `hc` client below is that
// contract: a path param is a string, and the generations POST body is
// the schema's shape, not `unknown`.
const client = hc<AppType>("http://x");

// `hc` performs the network fetch the moment a method is called, so
// every probe lives in a closure that is never invoked at runtime;
// `bun run typecheck` checks them anyway.
function inputTypeProbes() {
  // GET /api/models/:slug — the param comes from the route pattern.
  // @ts-expect-error a numeric slug is not the string param the route declares
  void client.api.models[":slug"].$get({ param: { slug: 42 } });

  // POST /api/models/:slug/terms/accept
  // @ts-expect-error a numeric slug is not the string param the route declares
  void client.api.models[":slug"].terms.accept.$post({ param: { slug: 42 } });

  // GET /api/models/:slug/generations
  // @ts-expect-error a numeric slug is not the string param the route declares
  void client.api.models[":slug"].generations.$get({ param: { slug: 42 } });

  // POST /api/models/:slug/generations — the validated JSON body keeps
  // the route's own zod schema's types (`validate("json", ...)`), so a
  // wrong-typed `modeId` is a tsc error, not silently `unknown`.
  void client.api.models[":slug"].generations.$post({
    param: { slug: "model-slug" },
    json: {
      // @ts-expect-error `modeId` is a string in the submit schema, not a number
      modeId: 42,
      revision: 1,
    },
  });

  // POST /api/submissions/:submissionId/cancel
  void client.api.submissions[":submissionId"].cancel.$post({
    param: {
      // @ts-expect-error a numeric submission id is not the string param the route declares
      submissionId: 42,
    },
  });

  // DELETE /api/submissions/:submissionId
  void client.api.submissions[":submissionId"].$delete({
    param: {
      // @ts-expect-error a numeric submission id is not the string param the route declares
      submissionId: 42,
    },
  });
}

test("hc<AppType> types the inputs of the converted routes", () => {
  // The runtime side is intentionally empty: the closure is only
  // referenced (never called — `hc` fetches at call time), and every
  // assertion above is a type checked by `bun run typecheck`.
  void inputTypeProbes;
});
