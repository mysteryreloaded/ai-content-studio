// Builds a BackendTarget that calls a real (or fake) ComfyUI's /system_stats,
// decrypting stored credentials per request.

import { DecryptionFailed } from "./credentials.js";
import { CredentialsNeedReentry } from "./monitor.js";
import type { BackendTarget, SystemStats } from "./monitor.js";
import type { BackendRecord, BackendRepository } from "./repository.js";

const FETCH_TIMEOUT_MS = 10_000;

/** Joins `baseUrl`'s own path (if any) with `/system_stats`, instead of `new URL` discarding it. */
export function systemStatsUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/system_stats`;
}

/** Joins `baseUrl`'s own path (if any) with `/object_info`, instead of `new URL` discarding it. */
export function objectInfoUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/object_info`;
}

function authHeaders(
  auth: BackendRecord["auth"],
  headerName: string | null,
  creds: { user?: string; pass?: string; value?: string } | null,
): Record<string, string> {
  if (auth === "basic" && creds?.user !== undefined) {
    return {
      authorization: `Basic ${btoa(`${creds.user}:${creds.pass ?? ""}`)}`,
    };
  }
  if (auth === "header" && headerName && creds?.value !== undefined) {
    return { [headerName]: creds.value };
  }
  return {};
}

export function backendTarget(
  backend: BackendRecord,
  repository: Pick<BackendRepository, "decryptedCredentials">,
  timeoutMs: number = FETCH_TIMEOUT_MS,
): BackendTarget {
  return {
    id: backend.id,
    name: backend.name,
    baseUrl: backend.baseUrl,
    async fetchSystemStats(): Promise<SystemStats> {
      let creds: { user?: string; pass?: string; value?: string } | null = null;
      try {
        creds = await repository.decryptedCredentials(backend.id);
      } catch (err) {
        if (err instanceof DecryptionFailed) throw new CredentialsNeedReentry();
        throw err;
      }

      const res = await fetch(systemStatsUrl(backend.baseUrl), {
        headers: authHeaders(backend.auth, backend.headerName, creds),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) throw new Error(`/system_stats returned ${res.status}`);

      const body = (await res.json()) as {
        system: { comfyui_version: string };
        devices: { vram_total: number; vram_free: number }[];
      };
      const device = body.devices[0];
      return {
        comfyuiVersion: body.system.comfyui_version,
        vramTotal: device?.vram_total ?? 0,
        vramFree: device?.vram_free ?? 0,
      };
    },
  };
}

export interface ObjectInfoTarget {
  fetchObjectInfo(): Promise<Record<string, unknown>>;
}

/** Like {@link backendTarget}, but for `/object_info` (issue #41): the node knowledge cache never keeps a {@link BackendRecord}, just this. */
export function objectInfoTarget(
  backend: BackendRecord,
  repository: Pick<BackendRepository, "decryptedCredentials">,
  timeoutMs: number = FETCH_TIMEOUT_MS,
): ObjectInfoTarget {
  return {
    async fetchObjectInfo(): Promise<Record<string, unknown>> {
      let creds: { user?: string; pass?: string; value?: string } | null = null;
      try {
        creds = await repository.decryptedCredentials(backend.id);
      } catch (err) {
        if (err instanceof DecryptionFailed) throw new CredentialsNeedReentry();
        throw err;
      }

      const res = await fetch(objectInfoUrl(backend.baseUrl), {
        headers: authHeaders(backend.auth, backend.headerName, creds),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) throw new Error(`/object_info returned ${res.status}`);

      return (await res.json()) as Record<string, unknown>;
    },
  };
}
