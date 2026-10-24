import type { Workflow } from "./types.js";

/**
 * Node class_types known to call an outside service using a key embedded
 * directly in the Workflow (issue #40). The list starts with
 * `GemmaAPITextEncode` and grows as more such nodes are identified.
 */
export const OUTSIDE_SERVICE_NODE_CLASSES: readonly string[] = [
  "GemmaAPITextEncode",
];

/**
 * The node field each outside-service class holds its key in.
 *
 * `GemmaAPITextEncode` isn't a published ComfyUI node yet — no node pack or
 * docs.comfy.org page defines it or an `api_key` input to confirm against.
 * `"api_key"` here is this project's own placeholder name, to be corrected
 * against the real node's `inputs` the moment it's integrated.
 */
const KEY_FIELD_BY_CLASS: Record<string, string> = {
  GemmaAPITextEncode: "api_key",
};

export interface OutsideServiceNote {
  nodeId: string;
  classType: string;
  /** True when the Workflow carries a non-empty key for this node — a save is refused while this is true. */
  keySet: boolean;
}

/**
 * Finds every outside-service node in the Workflow, and whether it still
 * carries a key. A save is refused while any note has `keySet: true`; an
 * empty key is allowed but shown to the Admin as a note.
 */
export function findOutsideServiceNotes(
  workflow: Workflow,
): OutsideServiceNote[] {
  const notes: OutsideServiceNote[] = [];
  for (const [nodeId, node] of Object.entries(workflow)) {
    const keyField = KEY_FIELD_BY_CLASS[node.class_type];
    if (!keyField) continue;
    const value = node.inputs[keyField];
    notes.push({
      nodeId,
      classType: node.class_type,
      keySet: typeof value === "string" && value.length > 0,
    });
  }
  return notes;
}
