import type { AppType } from "@ai-content-studio/server/app-type";
import { hc } from "hono/client";

/**
 * The typed `hc` client for the same-origin API (spec #33): `AppType` is
 * the composed server's full route schema (issue #164), so every call is
 * typed end to end. Types only — the server package is never bundled.
 */
export const api = hc<AppType>(window.location.origin);

/** A non-OK API response: the status plus whatever body was parsed. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(`API responded ${status}`);
    this.name = "ApiError";
  }
}

/** The part of an `hc` (hono/client) response that `ok` needs. */
type HcResponse = {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
};

/**
 * Awaits an `hc` response and returns its parsed JSON body, or throws an
 * `ApiError` (status + parsed body) when the response is not OK. Every
 * query and mutation checks the status through this one helper.
 */
export async function ok<T = unknown>(res: Promise<HcResponse>): Promise<T> {
  const response = await res;
  // Parse first, so a 4xx/5xx `ApiError` carries the server's body.
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(response.status, body);
  }
  return body as T;
}
