// A Mode's output nodes and Path (ADR 0001, issue #42).

import { computePath } from "./path.js";
import type { Workflow } from "./types.js";

export type AssetKind = "video" | "image" | "audio";

/**
 * Known ComfyUI save node classes mapped to the Asset kind they produce,
 * used to infer an output node's `kind` when the Admin doesn't set one.
 * Starts with the save nodes seen in practice and grows as more are
 * identified (same spirit as outside-service.ts's node class lists).
 */
export const SAVE_NODE_KINDS: Record<string, AssetKind> = {
  SaveImage: "image",
  SaveAnimatedPNG: "image",
  SaveAnimatedWEBP: "image",
  SaveAudio: "audio",
  SaveAudioMP3: "audio",
  SaveAudioOpus: "audio",
  VHS_VideoCombine: "video",
  SaveVideo: "video",
  SaveWEBM: "video",
};

/**
 * Preview-only node classes: ADR 0001 refuses these as a Mode's output
 * node ("side outputs such as a preview node ... are not allowed").
 * `PreviewImage`, `PreviewAudio`, `PreviewAny` and `Preview3D` are
 * ComfyUI's own core preview nodes; `MaskPreview` and VideoHelperSuite's
 * preview node are commonly paired with them.
 */
export const PREVIEW_NODE_CLASSES: ReadonlySet<string> = new Set([
  "PreviewImage",
  "PreviewAudio",
  "PreviewAny",
  "Preview3D",
  "MaskPreview",
  "VHS_VideoPreview",
]);

export function inferOutputNodeKind(classType: string): AssetKind | null {
  return SAVE_NODE_KINDS[classType] ?? null;
}

export function isPreviewNodeClass(classType: string): boolean {
  return PREVIEW_NODE_CLASSES.has(classType);
}

/** One of a Mode's ordered output nodes, resolved against its Workflow. */
export interface ResolvedOutputNode {
  nodeId: string;
  classType: string;
  title: string | null;
  kind: AssetKind | null;
}

export type ResolveOutputNodesResult =
  | { ok: true; outputNodes: ResolvedOutputNode[] }
  | { ok: false; errors: string[] };

/**
 * Resolves and validates a Mode's ordered output node ids against a
 * Workflow: each must exist and must not be a preview node, and there
 * must be at least one (the first is the main Asset).
 */
export function resolveModeOutputNodes(
  workflow: Workflow,
  outputNodeIds: readonly string[],
): ResolveOutputNodesResult {
  const errors: string[] = [];
  if (outputNodeIds.length === 0) {
    errors.push("a Mode needs at least one output node");
  }

  const seen = new Set<string>();
  const outputNodes: ResolvedOutputNode[] = [];
  for (const nodeId of outputNodeIds) {
    if (seen.has(nodeId)) {
      errors.push(`output node "${nodeId}" is named more than once`);
      continue;
    }
    seen.add(nodeId);

    const node = workflow[nodeId];
    if (!node) {
      errors.push(`output node "${nodeId}" is not in the Workflow`);
      continue;
    }
    if (isPreviewNodeClass(node.class_type)) {
      errors.push(
        `output node "${nodeId}" (${node.class_type}) is a preview node and can't be a Mode's output`,
      );
      continue;
    }
    outputNodes.push({
      nodeId,
      classType: node.class_type,
      title: node._meta?.title ?? null,
      kind: inferOutputNodeKind(node.class_type),
    });
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, outputNodes };
}

/** A Mode's Path (ADR 0001): its output nodes plus everything upstream. */
export function computeModePath(
  workflow: Workflow,
  outputNodeIds: readonly string[],
) {
  return computePath(workflow, outputNodeIds);
}

/** A Mode's name: 1-60 characters, unique among the Model's other Modes (case-insensitive). */
export function validateModeName(
  name: string,
  otherNames: readonly string[],
): string | null {
  if (name.length < 1 || name.length > 60) {
    return "must be 1-60 characters";
  }
  const lower = name.toLowerCase();
  if (otherNames.some((other) => other.toLowerCase() === lower)) {
    return "a Mode with this name already exists";
  }
  return null;
}
