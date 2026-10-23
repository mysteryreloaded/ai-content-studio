// Builds a BackendTarget that calls a real (or fake) ComfyUI's /system_stats,
// decrypting stored credentials per request.

import { DecryptionFailed } from "./credentials";
import { CredentialsNeedReentry, type BackendTarget, type SystemStats } from "./monitor";
import type { BackendRecord, BackendRepository } from "./repository";

function authHeaders(
  auth: BackendRecord["auth"],
  headerName: string | null,
  creds: { user?: string; pass?: string; value?: string } | null,
): Record<string, string> {
  if (auth === "basic" && creds?.user !== undefined) {
    return { authorization: `Basic ${btoa(`${creds.user}:${creds.pass ?? ""}`)}` };
  }
  if (auth === "header" && headerName && creds?.value !== undefined) {
    return { [headerName]: creds.value };
  }
  return {};
}

export function backendTarget(backend: BackendRecord, repository: BackendRepository): BackendTarget {
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

      const url = new URL("/system_stats", backend.baseUrl);
      const res = await fetch(url, { headers: authHeaders(backend.auth, backend.headerName, creds) });
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
