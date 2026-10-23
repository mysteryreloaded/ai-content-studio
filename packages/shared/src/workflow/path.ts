import { type NodeLink, type Workflow, isNodeLink } from "./types.js";

/**
 * ADR 0001: a Mode runs only its Path, computed by following links upstream
 * from its output nodes. A core ComfySwitchNode whose chosen side is known
 * before sending (a literal, or a primitive node feeding it) is followed on
 * that side only, so the other branch's nodes never reach the Backend.
 */
const SWITCH_CLASS = "ComfySwitchNode";
// ComfyUI's core switch names its boolean input "switch" (comfy_extras/nodes_logic.py: io.Boolean.Input("switch")).
const SWITCH_BOOLEAN_FIELD = "switch";
const SWITCH_BRANCH_FIELDS = { true: "on_true", false: "on_false" } as const;

const PRIMITIVE_CLASSES = new Set([
  "PrimitiveBoolean",
  "PrimitiveInt",
  "PrimitiveFloat",
  "PrimitiveString",
  "PrimitiveStringMultiline",
]);

/** Resolves a switch's boolean field to a known value, or undefined if it's missing or depends on an unresolved Input. */
function resolveKnownBoolean(
  workflow: Workflow,
  value: NodeLink | boolean | number | string | null | undefined,
  seen: Set<string> = new Set(),
): boolean | undefined {
  if (!isNodeLink(value)) {
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value !== 0;
    return undefined;
  }
  const [sourceId] = value;
  if (seen.has(sourceId)) return undefined;
  seen.add(sourceId);
  const source = workflow[sourceId];
  if (!source || !PRIMITIVE_CLASSES.has(source.class_type)) return undefined;
  return resolveKnownBoolean(
    workflow,
    source.inputs.value as
      | NodeLink
      | boolean
      | number
      | string
      | null
      | undefined,
    seen,
  );
}

export interface PathResult {
  /** Node ids on the Path: the output nodes plus every node they depend on. */
  nodeIds: Set<string>;
  /** Node ids named as output nodes that are missing from the Workflow. */
  missingOutputNodeIds: string[];
}

/** Computes the Path for a Mode: its output nodes plus every node they depend on. */
export function computePath(
  workflow: Workflow,
  outputNodeIds: readonly string[],
): PathResult {
  const nodeIds = new Set<string>();
  const missingOutputNodeIds: string[] = [];
  const queue: string[] = [];

  for (const id of outputNodeIds) {
    if (!workflow[id]) {
      missingOutputNodeIds.push(id);
      continue;
    }
    if (!nodeIds.has(id)) {
      nodeIds.add(id);
      queue.push(id);
    }
  }

  while (queue.length > 0) {
    const id = queue.shift() as string;
    const node = workflow[id];
    if (!node) continue;

    const isSwitch = node.class_type === SWITCH_CLASS;
    const known = isSwitch
      ? resolveKnownBoolean(
          workflow,
          node.inputs[SWITCH_BOOLEAN_FIELD] as Parameters<
            typeof resolveKnownBoolean
          >[1],
        )
      : undefined;
    const prunedBranchField =
      isSwitch && known !== undefined
        ? SWITCH_BRANCH_FIELDS[known ? "false" : "true"]
        : undefined;

    for (const [field, value] of Object.entries(node.inputs)) {
      if (field === prunedBranchField) continue;
      if (!isNodeLink(value)) continue;
      const [sourceId] = value;
      if (nodeIds.has(sourceId)) continue;
      nodeIds.add(sourceId);
      queue.push(sourceId);
    }
  }

  return { nodeIds, missingOutputNodeIds };
}

/** Builds the Path's own sub-Workflow: the same nodes, links untouched. */
export function extractPath(workflow: Workflow, path: PathResult): Workflow {
  const result: Workflow = {};
  for (const id of path.nodeIds) {
    const node = workflow[id];
    if (node) result[id] = node;
  }
  return result;
}
