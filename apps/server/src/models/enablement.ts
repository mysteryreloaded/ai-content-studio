// Whether a Model can be enabled (issue #42): >= 1 Mode, >= 1 attached
// Backend, valid output nodes, and every Mode runnable on at least one
// attached Backend (its Path's node types all installed there). Issue
// #50 adds: every Upload loader on a Mode's Path is fed by a shown Input
// or holds a fixed file, and a fixed file is on every enabled Backend.

import type {
  ComfyFieldSpec,
  ModeInputSetting,
  Workflow,
} from "@ai-content-studio/shared";
import {
  applyModeFixedValues,
  computeModePath,
  fieldKey,
  isNodeLink,
  modeInputSetting,
  relevantInputs,
  visibleModeBoundFields,
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
  for (const input of detail.inputs) {
    if (input.kind === "seed" && input.max === null) {
      reasons.push(`Seed Input "${input.label}" needs a max before enabling`);
    }
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
    // issue #48: a switch steered by a field one of this Mode's visible
    // Inputs binds keeps both branches on the Path, since the Admin
    // can't know ahead of time which way a user will set it — both
    // branches' node types must be covered by a Backend for the Mode
    // to count as runnable.
    const unresolvable = visibleModeBoundFields(
      mode.inputSettings,
      detail.inputs,
    );
    const outputNodeIds = mode.outputNodes.map((node) => node.nodeId);
    // issue #48 CEO review: a fixed Input's value is known before
    // sending (ADR 0001), so it must pick its switch's side here too —
    // or hasUsableBackend/enablement end up checking the wrong side's
    // node types.
    const workflowForMode = applyModeFixedValues(
      detail.workflow,
      detail.inputs,
      mode.inputSettings,
    );
    const path = computeModePath(workflowForMode, outputNodeIds, unresolvable);
    if (path.missingOutputNodeIds.length > 0) {
      reasons.push(
        `Mode "${mode.name}" names an output node no longer in the Workflow`,
      );
      continue;
    }

    const pathClassTypes = [...path.nodeIds]
      .map((nodeId) => workflowForMode[nodeId]?.class_type)
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
        workflowForMode,
        detail.inputs,
        mode.inputSettings,
        mode.name,
        outputNodeIds,
        unresolvable,
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
  workflow: Workflow,
  inputs: ModelDetail["inputs"],
  inputSettings: readonly ModeInputSetting[],
  modeName: string,
  outputNodeIds: readonly string[],
  unresolvable: ReadonlySet<string>,
  pathNodeIds: ReadonlySet<string>,
  specsByBackend: ReadonlyArray<{
    backend: BackendRecord;
    specs: Map<string, Record<string, ComfyFieldSpec>>;
  }>,
): string[] {
  const reasons: string[] = [];
  // A hidden Input's binding doesn't count as "shown" even though it's
  // still relevant to the Path (issue #48 CEO review); the switch's own
  // unresolvable fields must be passed too, or a visible Input steering
  // one gets pruned to the wrong side here same as everywhere else.
  const shownFields = new Set(
    relevantInputs(inputs, workflow, outputNodeIds, unresolvable)
      .filter(
        (input) => modeInputSetting(inputSettings, input.id).state !== "hidden",
      )
      .flatMap((input) =>
        input.bindings.map((b) => fieldKey(b.nodeId, b.field)),
      ),
  );

  for (const nodeId of pathNodeIds) {
    const node = workflow[nodeId];
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
