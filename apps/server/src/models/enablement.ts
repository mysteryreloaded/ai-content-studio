// Whether a Model can be enabled (issue #42): >= 1 Mode, >= 1 attached
// Backend, valid output nodes, and every Mode runnable on at least one
// attached Backend (its Path's node types all installed there). Issue
// #50 adds: every Upload loader on a Mode's Path is fed by a shown Input
// or holds a fixed file, and a fixed file is on every enabled Backend.

import type { ComfyFieldSpec } from "@ai-content-studio/shared";
import {
  computeModePath,
  fieldKey,
  isNodeLink,
  relevantInputs,
} from "@ai-content-studio/shared";
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

  const enabledBackends = attachedBackends.filter((b) => b.enabled);
  const specsByBackend = (
    await Promise.all(
      enabledBackends.map(async (backend) => ({
        backend,
        specs: await backendsService.fieldSpecsFor(backend),
      })),
    )
  ).filter(
    (
      entry,
    ): entry is {
      backend: BackendRecord;
      specs: Map<string, Record<string, ComfyFieldSpec>>;
    } => entry.specs !== null,
  );

  for (const mode of detail.modes) {
    const outputNodeIds = mode.outputNodes.map((node) => node.nodeId);
    const path = computeModePath(detail.workflow, outputNodeIds);
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

    reasons.push(
      ...uploadLoaderReasons(
        detail,
        mode.name,
        outputNodeIds,
        path.nodeIds,
        specsByBackend,
      ),
    );
  }

  return { ok: reasons.length === 0, reasons };
}

/**
 * Issue #50: a field a Backend flags `image_upload` on the Path is an
 * Upload loader. It must be fed by a shown Input, or else hold a fixed
 * value; a fixed bare file name must be one of every enabled Backend's
 * own choices for that field. Backends whose field shapes can't be read
 * (unreachable) are skipped.
 */
function uploadLoaderReasons(
  detail: ModelDetail,
  modeName: string,
  outputNodeIds: readonly string[],
  pathNodeIds: ReadonlySet<string>,
  specsByBackend: ReadonlyArray<{
    backend: BackendRecord;
    specs: Map<string, Record<string, ComfyFieldSpec>>;
  }>,
): string[] {
  const reasons: string[] = [];
  const shownFields = new Set(
    relevantInputs(detail.inputs, detail.workflow, outputNodeIds).flatMap(
      (input) => input.bindings.map((b) => fieldKey(b.nodeId, b.field)),
    ),
  );

  for (const nodeId of pathNodeIds) {
    const node = detail.workflow[nodeId];
    if (!node) continue;
    const loaderFields = new Set(
      specsByBackend.flatMap(({ specs }) =>
        Object.entries(specs.get(node.class_type) ?? {})
          .filter(([, spec]) => spec.imageUpload)
          .map(([field]) => field),
      ),
    );

    for (const field of loaderFields) {
      if (shownFields.has(fieldKey(nodeId, field))) continue;
      const value = node.inputs[field];
      if (isNodeLink(value)) continue;
      if (typeof value !== "string" || value.trim() === "") {
        reasons.push(
          `Mode "${modeName}": Upload loader "${nodeId}" (${node.class_type}) has neither a shown Input nor a fixed value for "${field}"`,
        );
        continue;
      }
      if (value.includes("/") || value.includes("\\")) continue;
      for (const { backend, specs } of specsByBackend) {
        const options = specs.get(node.class_type)?.[field]?.options;
        if (options && !options.includes(value)) {
          reasons.push(
            `Mode "${modeName}": fixed file "${value}" for Upload loader "${nodeId}" isn't on Backend "${backend.name}"`,
          );
        }
      }
    }
  }
  return reasons;
}
