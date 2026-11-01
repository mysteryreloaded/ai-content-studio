import type { AppType } from "@ai-content-studio/server/app-type";
import { hc } from "hono/client";

/**
 * The typed Hono client (spec #33's "Hono `hc` client"): the base URL is
 * empty, so every call is same-origin under `/api/...` — the Vite dev
 * server proxies it to the API, and the server serves the same paths in
 * production.
 *
 * `hc`'s return type expands into the server's route-internal types,
 * which this project cannot name in its declaration output (TS2742), so
 * the client's type is spelled out here explicitly.
 */
export type ApiClient = ReturnType<typeof hc<AppType>>;
export const api: ApiClient = hc<AppType>("");

/**
 * A failed API response, with its status and parsed JSON body. Every
 * query/mutation goes through `ok`, so a component can branch on the
 * status and read the body (e.g. a 400's `issues`) without re-parsing.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    super(`API error ${status}`);
    this.name = "ApiError";
  }
}

/**
 * What `ok` needs from a response: the `ok` flag, the status, and the
 * JSON body. Both a raw `Response` and `hc`'s `ClientResponse` satisfy
 * it — hono's `ClientResponse` is a different structural type, not a
 * `Response` subtype, so `ok` cannot simply take `Response`.
 */
export type ResponseLike = {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
};

/**
 * Unwraps an `hc` response (or its `Promise`): when `!res.ok` it throws
 * `ApiError` (status + parsed body), so every query and mutation checks
 * the status exactly once, here.
 */
export async function ok<T>(
  res: ResponseLike | Promise<ResponseLike>,
): Promise<T> {
  const r = await res;
  // Parse before checking `ok` so the thrown error can carry the body;
  // a body that isn't valid JSON (e.g. an empty 204) becomes `null`.
  const body: unknown = await r.json().catch(() => null);
  if (!r.ok) throw new ApiError(r.status, body);
  return body as T;
}
