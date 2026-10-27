/**
 * Type-only entry point of `@ai-content-studio/server`: the full route
 * schema of the composed app, for the typed `hc` client
 * (`hc<AppType>(url)`). Consumers should import types from
 * `@ai-content-studio/server/app-type` — never from this file's runtime
 * module graph, which stays import-free for that reason.
 */
export type { AppType } from "./app.js";
