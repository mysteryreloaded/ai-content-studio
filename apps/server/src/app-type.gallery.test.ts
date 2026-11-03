import { test } from "bun:test";
import { hc } from "hono/client";
import type { AppType } from "./app-type.js";

// Type-only test (issue #190): the Gallery list's response shape —
// `hasMore` and each Submission's `prompt` and `uploads` (and each
// Generation asset's media-shape fields) must reach the typed `hc`
// client with their exact types, not as `unknown` through an erased
// `: Hono<AppEnv>` annotation. The client below is only ever
// type-referenced, never fetched (`hc` fetches at method-call time, as
// `app-type.test.ts` notes); `bun run typecheck` checks the types.
const client = hc<AppType>("http://x");

// A branch that replies with `c.json(...)` without an explicit status
// carries Hono's default `ContentfulStatusCode` rather than the literal
// `200`, so `Extract<..., { status: 200 }>` can't select it — drop the
// explicitly-typed error branches instead and infer the body off
// `json()`.
type GalleryListResponse = Awaited<ReturnType<typeof client.api.gallery.$get>>;
type GalleryListBody = Exclude<
  GalleryListResponse,
  { status: 401 | 404 }
> extends { json: () => Promise<infer P> }
  ? P
  : never;

// Ambient: type-checked, erased at runtime (the probes below never
// fetch — they only use these types).
declare const galleryBody: GalleryListBody;
declare const gallerySubmission: GalleryListBody["submissions"][number];
declare const galleryUpload: GalleryListBody["submissions"][number]["uploads"][number];
declare const galleryAsset: (typeof gallerySubmission)["generations"][number]["assets"][number];

function listResponseProbes() {
  const hasMore: boolean = galleryBody.hasMore;
  // @ts-expect-error `hasMore` is a boolean, not a string
  const hasMoreAsString: string = galleryBody.hasMore;

  const prompt: string | null = gallerySubmission.prompt;
  // @ts-expect-error a prompt is text (or absent), not a number
  const promptAsNumber: number = gallerySubmission.prompt;

  const kind: "image" | "video" | "audio" = galleryUpload.kind;
  // @ts-expect-error the union of the three kinds, not any string
  const kindFromAnyString: typeof kind = "something else";
  const thumbnailKey: string | null = galleryUpload.thumbnailKey;
  const removed: boolean = galleryUpload.removed;

  // The asset's media shape: `size` is always present, the dimensions
  // and duration null when finishing couldn't read the file.
  const size: number = galleryAsset.size;
  // @ts-expect-error `size` is never null
  const sizeAsNull: null = galleryAsset.size;
  const width: number | null = galleryAsset.width;
  const height: number | null = galleryAsset.height;
  const durationMs: number | null = galleryAsset.durationMs;

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

test("hc<AppType> types the Gallery list's response (issue #190)", () => {
  // Referenced, never called; only `bun run typecheck` runs the types
  // above.
  void listResponseProbes;
});
