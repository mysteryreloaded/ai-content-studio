import {
  OUTSIDE_SERVICE_NODE_CLASSES,
  PREVIEW_NODE_CLASSES,
  SAVE_NODE_KINDS,
  VIDEO_LOADER_CLASS_TYPES,
  applyModeFixedValues,
  visibleModeBoundFields,
} from "@ai-content-studio/shared";
import type {
  CheckModelBackend,
  InputDefinition,
  Workflow,
} from "@ai-content-studio/shared";
import type {
  BrokenNodeRef,
  DraftMode,
  ModeRecord,
  ModelDetail,
  ModelNode,
  ObjectInfoBackendJson,
} from "../types.js";
/** A bound field's own JS value type, for coercing a select option's typed-in value to match it (issue #46). */
export function bindingValueKind(
  workflow: Workflow,
  nodeId: string,
  field: string,
): "string" | "number" | "boolean" | null {
  const value = workflow[nodeId]?.inputs[field];
  if (value === undefined || value === null) return null;
  if (Array.isArray(value)) return null;
  return typeof value as "string" | "number" | "boolean";
}
/** A bound field's COMBO choices, from whichever attached Backend reports them (issue #215's select options table); null when none does, or the field isn't a COMBO. */
export function comboOptionsFor(
  backends: CheckModelBackend[] | null,
  classType: string,
  field: string,
): readonly string[] | null {
  if (!backends) return null;
  for (const backend of backends) {
    const spec = backend.fieldSpecs?.get(classType)?.[field];
    if (spec?.type === "COMBO" && spec.options) return spec.options;
  }
  return null;
}

/** `pendingWorkflow`'s own nodes, the same shape `detail.nodes` is in, for the rebind picker's node choices (issue #71). */
export function nodesFromWorkflow(workflow: Workflow): ModelNode[] {
  return Object.entries(workflow).map(([id, node]) => ({
    id,
    classType: node.class_type,
    title: node._meta?.title ?? null,
  }));
}
/**
 * Every Mode output node and Input binding whose saved classType no
 * longer matches (or whose node id is gone from) `pendingWorkflow`
 * (issue #71's rebind picker): the same staleness `checkModel` itself
 * flags, surfaced here by node id so each one gets its own picker. One
 * entry per broken node id — the rebind, like the carry-forward it
 * fixes, is "by node id" (ADR-0010).
 */
export function findBrokenNodeRefs(
  detail: ModelDetail,
  pendingWorkflow: Workflow,
): BrokenNodeRef[] {
  const broken: BrokenNodeRef[] = [];
  const seen = new Set<string>();

  function isBroken(nodeId: string, savedClassType: string): boolean {
    const node = pendingWorkflow[nodeId];
    return !node || node.class_type !== savedClassType;
  }

  for (const mode of detail.modes) {
    for (const node of mode.outputNodes) {
      if (seen.has(node.nodeId) || !isBroken(node.nodeId, node.classType)) {
        continue;
      }
      seen.add(node.nodeId);
      broken.push({
        nodeId: node.nodeId,
        description: `Mode "${mode.name || "this Mode"}"'s output node "${node.nodeId}" (was ${node.classType})`,
      });
    }
  }
  for (const input of detail.inputs) {
    for (const binding of input.bindings) {
      if (
        seen.has(binding.nodeId) ||
        !isBroken(binding.nodeId, binding.classType)
      ) {
        continue;
      }
      seen.add(binding.nodeId);
      broken.push({
        nodeId: binding.nodeId,
        description: `Input "${input.label || "this Input"}"'s "${binding.field}" binding, node "${binding.nodeId}" (was ${binding.classType})`,
      });
    }
  }
  return broken;
}
/** `detail.modes` turned into `checkModel`'s `CheckModelMode`s, with `rebindMap` applied first: a remapped output node is dropped from the staleness check since it's now fresh (issue #71). */
export function checkModelModesFrom(
  modes: ModeRecord[],
  rebindMap: Readonly<Record<string, string>>,
) {
  return modes.map((mode) => ({
    id: mode.id,
    name: mode.name,
    outputNodeIds: mode.outputNodes.map(
      (node) => rebindMap[node.nodeId] ?? node.nodeId,
    ),
    outputNodeClassTypes: Object.fromEntries(
      mode.outputNodes
        .filter((node) => !(node.nodeId in rebindMap))
        .map((node) => [node.nodeId, node.classType]),
    ),
    inputSettings: mode.inputSettings,
  }));
}
/** `detail.inputs` with `rebindMap` applied to each binding's node id (and its snapshotted classType/title) against `workflow` (issue #71). */
export function reboundInputsFrom(
  inputs: InputDefinition[],
  workflow: Workflow,
  rebindMap: Readonly<Record<string, string>>,
): InputDefinition[] {
  if (Object.keys(rebindMap).length === 0) return inputs;
  return inputs.map((input) => ({
    ...input,
    bindings: input.bindings.map((binding) => {
      const newNodeId = rebindMap[binding.nodeId];
      if (!newNodeId) return binding;
      const node = workflow[newNodeId];
      return {
        ...binding,
        nodeId: newNodeId,
        classType: node?.class_type ?? binding.classType,
        title: node?._meta?.title ?? null,
      };
    }),
  }));
}
/** This Mode's visible (optional/required) bound fields, for `computeModePath`'s unresolvableFields (issue #48). */
export function visibleBoundFieldsFor(
  mode: DraftMode,
  inputs: InputDefinition[],
): Set<string> {
  return visibleModeBoundFields(mode.inputSettings, inputs);
}
/**
 * This Mode's Workflow, with its fixed Input values written in (issue
 * #48 CEO review): a fixed value is known before sending (ADR 0001), so
 * every Path computed for display must pick its switch's side the same
 * way the real prompt would.
 */
export function workflowForMode(
  mode: DraftMode,
  inputs: InputDefinition[],
  workflow: Workflow,
): Workflow {
  return applyModeFixedValues(workflow, inputs, mode.inputSettings);
}
/** Node ids this Input's bindings touch, to decide which Modes its Path makes "eligible" (issue #48). */
export function boundNodeIds(input: InputDefinition): Set<string> {
  return new Set(input.bindings.map((binding) => binding.nodeId));
}
/** Turns `object-info`'s JSON back into `checkModel`'s `CheckModelBackend`s, so the rail runs live, client-side. */
export function toCheckModelBackends(
  backends: ObjectInfoBackendJson[],
): CheckModelBackend[] {
  return backends.map((backend) => ({
    id: backend.id,
    name: backend.name,
    enabled: backend.enabled,
    reachable: backend.reachable,
    nodeTypes: new Set(backend.nodeTypes),
    fieldSpecs: new Map(
      Object.entries(backend.fieldSpecs),
    ) as CheckModelBackend["fieldSpecs"],
  }));
}

/** Issue #214's node groups, in the agreed order. */
export const GROUP_ORDER = [
  "Upload loaders",
  "Values and switches",
  "Prompts and conditioning",
  "Outputs",
  "Outside services",
  "Models and LoRAs",
  "Sampling and the rest",
] as const;

export type NodeGroup = (typeof GROUP_ORDER)[number];

const AUDIO_LOADER_RE = /load.*audio|audio.*load/i;

/** Which of the agreed groups a node's class falls into (issue #214). */
export function nodeGroup(classType: string): NodeGroup {
  if (
    classType === "LoadImage" ||
    VIDEO_LOADER_CLASS_TYPES.has(classType) ||
    AUDIO_LOADER_RE.test(classType)
  ) {
    return "Upload loaders";
  }
  if (
    classType.startsWith("Primitive") ||
    classType === "INTConstant" ||
    classType === "mxSlider" ||
    classType === "ResolutionSelector" ||
    classType === "ComfySwitchNode" ||
    classType === "MathExpression"
  ) {
    return "Values and switches";
  }
  if (
    classType.startsWith("CLIPTextEncode") ||
    classType.includes("Conditioning")
  ) {
    return "Prompts and conditioning";
  }
  if (classType in SAVE_NODE_KINDS || PREVIEW_NODE_CLASSES.has(classType)) {
    return "Outputs";
  }
  if (OUTSIDE_SERVICE_NODE_CLASSES.includes(classType)) {
    return "Outside services";
  }
  if (classType.includes("Loader") || classType.includes("LoRA")) {
    return "Models and LoRAs";
  }
  return "Sampling and the rest";
}
