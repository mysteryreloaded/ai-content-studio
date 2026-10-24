// Gathers every attached Backend's `/object_info` knowledge into the
// plain, JSON-serializable shape `checkModel` (issue #49) needs: the
// editor rail fetches this once and then runs `checkModel` itself, live,
// against whatever's in its draft.

import type {
  CheckModelBackend,
  ComfyFieldSpec,
} from "@ai-content-studio/shared";
import type { BackendRecord } from "../backends/repository.js";
import type { BackendsService } from "../backends/service.js";

export interface ObjectInfoBackendJson {
  id: string;
  name: string;
  enabled: boolean;
  reachable: boolean;
  nodeTypes: string[];
  fieldSpecs: Record<string, Record<string, ComfyFieldSpec>>;
}

export async function buildObjectInfo(
  attached: readonly BackendRecord[],
  backendsService: BackendsService,
): Promise<ObjectInfoBackendJson[]> {
  return Promise.all(
    attached.map(async (backend) => {
      const [nodeTypes, fieldSpecs] = await Promise.all([
        backendsService.nodeTypesFor(backend),
        backendsService.fieldSpecsFor(backend),
      ]);
      return {
        id: backend.id,
        name: backend.name,
        enabled: backend.enabled,
        reachable: nodeTypes !== null,
        nodeTypes: nodeTypes ? [...nodeTypes] : [],
        fieldSpecs: fieldSpecs ? Object.fromEntries(fieldSpecs) : {},
      };
    }),
  );
}

/** `buildObjectInfo`'s JSON shape, turned back into `checkModel`'s `CheckModelBackend`s. */
export function toCheckModelBackends(
  backends: readonly ObjectInfoBackendJson[],
): CheckModelBackend[] {
  return backends.map((backend) => ({
    id: backend.id,
    name: backend.name,
    enabled: backend.enabled,
    reachable: backend.reachable,
    nodeTypes: new Set(backend.nodeTypes),
    fieldSpecs: new Map(Object.entries(backend.fieldSpecs)),
  }));
}
