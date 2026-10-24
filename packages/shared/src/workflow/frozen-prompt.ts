// A Generation's frozen, built prompt (issue #43): a Mode's Path, with
// each output node's `filename_prefix` set to `studio/<generation-id>/`.

import { computePath, extractPath } from "./path.js";
import type { Workflow } from "./types.js";

export interface FrozenPrompt {
  /** The Mode's Path, output nodes stamped with their `filename_prefix`. */
  prompt: Workflow;
  /** The distinct node class types on the Path, for matching against a Backend's node knowledge. */
  nodeTypes: string[];
}

/** Builds the prompt a Generation sends: its Mode's Path, output nodes stamped for storage under `studio/<generationId>/`. */
export function buildFrozenPrompt(
  workflow: Workflow,
  outputNodeIds: readonly string[],
  generationId: string,
): FrozenPrompt {
  const path = computePath(workflow, outputNodeIds);
  const extracted = extractPath(workflow, path);
  const outputSet = new Set(outputNodeIds);
  const prefix = `studio/${generationId}/`;

  const prompt: Workflow = {};
  for (const [id, node] of Object.entries(extracted)) {
    prompt[id] = outputSet.has(id)
      ? { ...node, inputs: { ...node.inputs, filename_prefix: prefix } }
      : node;
  }

  const nodeTypes = [
    ...new Set(Object.values(prompt).map((node) => node.class_type)),
  ].sort();

  return { prompt, nodeTypes };
}
