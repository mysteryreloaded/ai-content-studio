// Whether a Model can be enabled (issue #42): >= 1 Mode, >= 1 attached
// Backend, valid output nodes, and every Mode runnable on at least one
// attached Backend (its Path's node types all installed there).

import { computeModePath } from "@ai-content-studio/shared";
import type { BackendRecord } from "../backends/repository.js";
import type { BackendsService } from "../backends/service.js";
import type { ModelDetail } from "./repository.js";

export interface EnableReadiness {
  ok: boolean;
  reasons: string[];
}

export async function checkEnableReadiness(
  detail: ModelDetail,
  attachedBackends: BackendRecord[],
  backendsService: BackendsService,
): Promise<EnableReadiness> {
  const reasons: string[] = [];

  if (detail.modes.length === 0) {
    reasons.push("needs at least one Mode");
  }
  if (attachedBackends.length === 0) {
    reasons.push("needs at least one attached Backend");
  }

  if (detail.modes.length === 0 || attachedBackends.length === 0) {
    return { ok: false, reasons };
  }

  const nodeTypesByBackend = await Promise.all(
    attachedBackends.map((backend) => backendsService.nodeTypesFor(backend)),
  );
  const reachableNodeTypes = nodeTypesByBackend.filter(
    (types): types is Set<string> => types !== null,
  );

  for (const mode of detail.modes) {
    const path = computeModePath(
      detail.workflow,
      mode.outputNodes.map((node) => node.nodeId),
    );
    if (path.missingOutputNodeIds.length > 0) {
      reasons.push(
        `Mode "${mode.name}" names an output node no longer in the Workflow`,
      );
      continue;
    }

    const pathClassTypes = [...path.nodeIds]
      .map((nodeId) => detail.workflow[nodeId]?.class_type)
      .filter((classType): classType is string => Boolean(classType));

    const runnable = reachableNodeTypes.some((nodeTypes) =>
      pathClassTypes.every((classType) => nodeTypes.has(classType)),
    );
    if (!runnable) {
      reasons.push(
        `Mode "${mode.name}" isn't runnable on any attached Backend (missing node types)`,
      );
    }
  }

  return { ok: reasons.length === 0, reasons };
}
