// Shared by this directory's component test files. `bun test` runs every
// file in one process, and @testing-library/react binds its `screen`
// helper to `document.body` the first time it's imported — re-registering
// a second happy-dom window later (register/unregister per file) leaves
// that binding pointing at a closed window, so registration here is
// idempotent and never undone.
//
// The server's test files (run in this same process) need Bun's own
// fetch/Request/Response/Headers/Blob/File untouched — a mock OIDC
// issuer, Backend health checks, Hono's own `app.request()`, and
// admin-site-settings's `instanceof File` check all depend on them — so
// those specific globals are restored right after registering happy-dom.
// No component test needs happy-dom's fetch: each one replaces
// `globalThis.fetch` itself with its own mock.
import { GlobalRegistrator } from "@happy-dom/global-registrator";

const NETWORK_GLOBALS = [
  "fetch",
  "Request",
  "Response",
  "Headers",
  "FormData",
  "AbortController",
  "AbortSignal",
  "Blob",
  "File",
] as const;

/** Bun's own `fetch`, captured before happy-dom registers (see below). */
export const BUN_FETCH = globalThis.fetch;

if (!GlobalRegistrator.isRegistered) {
  const bunNetworkGlobals = Object.fromEntries(
    NETWORK_GLOBALS.map((key) => [key, globalThis[key]]),
  );
  await GlobalRegistrator.register();
  Object.assign(globalThis, bunNetworkGlobals);
}
