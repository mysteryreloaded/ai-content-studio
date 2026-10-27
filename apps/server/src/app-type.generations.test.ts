import { test } from "bun:test";
import { hc } from "hono/client";
import type { AppType } from "./app.js";

// Type-only test (issue #167): one `hc<AppType>` call per converted
// generations/assets/uploads endpoint — the ones with a path param or a JSON
// body — each with one deliberately-wrong field. The calls are never invoked
// (an `hc` method fetches at call time, as `app-type.test.ts` notes); they
// exist so `bun run typecheck` proves the chained routes still land in
// `AppType` with their param and body types intact, i.e. dropping the
// `: Hono<AppEnv>` return annotation kept the schema in the app's type.
const client = hc<AppType>("http://x");
const ID = "00000000-0000-0000-0000-000000000000";

// --- /api/generations ---
function generationsGet(): void {
  client.api.generations[":id"].$get({
    // @ts-expect-error — `:id` needs `param.id`, not `param.bogus`.
    param: { bogus: ID },
  });
}

function generationsDelete(): void {
  client.api.generations[":id"].$delete({
    // @ts-expect-error — `:id` needs `param.id`, not `param.bogus`.
    param: { bogus: ID },
  });
}

function generationsDismissRemoved(): void {
  client.api.generations[":id"]["dismiss-removed"].$post({
    // @ts-expect-error — `:id` needs `param.id`, not `param.bogus`.
    param: { bogus: ID },
  });
}

// --- /api/assets ---
function assetsGet(): void {
  client.api.assets[":id"].$get({
    // @ts-expect-error — `:id` needs `param.id`, not `param.bogus`.
    param: { bogus: ID },
  });
}

function assetsPoster(): void {
  client.api.assets[":id"].poster.$get({
    // @ts-expect-error — `:id` needs `param.id`, not `param.bogus`.
    param: { bogus: ID },
  });
}

function assetsThumb(): void {
  client.api.assets[":id"].thumb.$get({
    // @ts-expect-error — `:id` needs `param.id`, not `param.bogus`.
    param: { bogus: ID },
  });
}

// --- /api/uploads ---
function uploadsCreate(): void {
  client.api.uploads.$post({
    // @ts-expect-error — the body is the create schema: `name`, `size`, `type`.
    json: { bogus: ID },
  });
}

function uploadsStatus(): void {
  client.api.uploads[":id"].status.$get({
    // @ts-expect-error — `:id` needs `param.id`, not `param.bogus`.
    param: { bogus: ID },
  });
}

function uploadsChunk(): void {
  client.api.uploads[":id"].chunk.$put({
    // @ts-expect-error — `:id` needs `param.id`, not `param.bogus`.
    param: { bogus: ID },
  });
}

function uploadsComplete(): void {
  client.api.uploads[":id"].complete.$post({
    // @ts-expect-error — `:id` needs `param.id`, not `param.bogus`.
    param: { bogus: ID },
  });
}

function uploadsTrim(): void {
  client.api.uploads[":id"].trim.$post({
    param: { id: ID },
    // @ts-expect-error — the body is `{ startMs, endMs }`, not `bogus`.
    json: { bogus: ID },
  });
}

function uploadsGet(): void {
  client.api.uploads[":id"].$get({
    // @ts-expect-error — `:id` needs `param.id`, not `param.bogus`.
    param: { bogus: ID },
  });
}

function uploadsThumb(): void {
  client.api.uploads[":id"].thumb.$get({
    // @ts-expect-error — `:id` needs `param.id`, not `param.bogus`.
    param: { bogus: ID },
  });
}

test("hc<AppType> types every converted generations, assets and uploads route", () => {
  // Referenced, never called (the bodies fetch at call time); only
  // `bun run typecheck` runs them.
  void [
    generationsGet,
    generationsDelete,
    generationsDismissRemoved,
    assetsGet,
    assetsPoster,
    assetsThumb,
    uploadsCreate,
    uploadsStatus,
    uploadsChunk,
    uploadsComplete,
    uploadsTrim,
    uploadsGet,
    uploadsThumb,
  ];
});
