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

// (issue #190) The Workbench list's response shape: `hasMore` and each
// Submission's `prompt` and `uploads` (and each Generation asset's
// media-shape fields) must reach the typed client with their exact
// types, not as `unknown` through an erased `: Hono<AppEnv>` annotation.
//
// A branch that replies with `c.json(...)` without an explicit status
// carries Hono's default `ContentfulStatusCode` rather than the literal
// `200`, so `Extract<..., { status: 200 }>` can't select it — drop the
// explicitly-typed error branches instead and infer the body off
// `json()`.
type ModelsApi = (typeof client.api)["models"];
type WorkbenchListResponse = Awaited<
  ReturnType<ModelsApi[":slug"]["generations"]["$get"]>
>;
type WorkbenchListBody = Exclude<
  WorkbenchListResponse,
  { status: 401 | 404 }
> extends { json: () => Promise<infer P> }
  ? P
  : never;

// Ambient: type-checked, erased at runtime (the probes below never
// fetch — they only use these types).
declare const workbenchBody: WorkbenchListBody;
declare const workbenchSubmission: WorkbenchListBody["submissions"][number];
declare const workbenchUpload: WorkbenchListBody["submissions"][number]["uploads"][number];
declare const workbenchAsset: (typeof workbenchSubmission)["generations"][number]["assets"][number];

function workbenchListResponseProbes() {
  const hasMore: boolean = workbenchBody.hasMore;
  // @ts-expect-error `hasMore` is a boolean, not a string
  const hasMoreAsString: string = workbenchBody.hasMore;

  const prompt: string | null = workbenchSubmission.prompt;
  // @ts-expect-error a prompt is text (or absent), not a number
  const promptAsNumber: number = workbenchSubmission.prompt;

  const kind: "image" | "video" | "audio" = workbenchUpload.kind;
  // @ts-expect-error the union of the three kinds, not any string
  const kindFromAnyString: typeof kind = "something else";
  const thumbnailKey: string | null = workbenchUpload.thumbnailKey;
  const removed: boolean = workbenchUpload.removed;

  // The asset's media shape: `size` is always present, the dimensions
  // and duration null when finishing couldn't read the file.
  const size: number = workbenchAsset.size;
  // @ts-expect-error `size` is never null
  const sizeAsNull: null = workbenchAsset.size;
  const width: number | null = workbenchAsset.width;
  const height: number | null = workbenchAsset.height;
  const durationMs: number | null = workbenchAsset.durationMs;

  void [
    hasMore,
    hasMoreAsString,
    prompt,
    promptAsNumber,
    kind,
    kindFromAnyString,
    thumbnailKey,
    removed,
    size,
    sizeAsNull,
    width,
    height,
    durationMs,
  ];
}

test("hc<AppType> types the inputs of the converted routes", () => {
  // The runtime side is intentionally empty: the closure is only
  // referenced (never called — `hc` fetches at call time), and every
  // assertion above is a type checked by `bun run typecheck`.
  void inputTypeProbes;
});

test("hc<AppType> types the Workbench list's response (issue #190)", () => {
  void workbenchListResponseProbes;
});
