import { type NodeInputs, type Workflow, isNodeLink } from "./types.js";

export interface WorkflowFormatError {
  message: string;
}

/** A ComfyUI UI-format save: `{ nodes: [...], links: [...] }` rather than node-id-keyed API format. */
export function looksLikeUiFormat(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const obj = value as Record<string, unknown>;
  return Array.isArray(obj.nodes) && Array.isArray(obj.links);
}

export type WorkflowParseResult =
  | { ok: true; workflow: Workflow }
  | { ok: false; error: string };

/**
 * Parses and structurally validates an uploaded Workflow (issue #40): must
 * be API format, and every entry must have a `class_type` and `inputs`.
 */
export function parseApiFormatWorkflow(value: unknown): WorkflowParseResult {
  if (looksLikeUiFormat(value)) {
    return {
      ok: false,
      error: "This is a UI save; export it with Export (API)",
    };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: "Workflow must be a JSON object of nodes" };
  }

  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) {
    return { ok: false, error: "Workflow has no nodes" };
  }

  const workflow: Workflow = {};
  for (const [id, raw] of entries) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return { ok: false, error: `node "${id}" is not an object` };
    }
    const node = raw as Record<string, unknown>;
    if (typeof node.class_type !== "string" || node.class_type.length === 0) {
      return { ok: false, error: `node "${id}" is missing class_type` };
    }
    if (
      !node.inputs ||
      typeof node.inputs !== "object" ||
      Array.isArray(node.inputs)
    ) {
      return { ok: false, error: `node "${id}" is missing inputs` };
    }
    const meta =
      node._meta && typeof node._meta === "object"
        ? (node._meta as { title?: string })
        : undefined;
    workflow[id] = {
      class_type: node.class_type,
      inputs: node.inputs as NodeInputs,
      ...(meta ? { _meta: meta } : {}),
    };
  }
  return { ok: true, workflow };
}

/** Node ids that a link points to but that aren't in the Workflow — each is a save error (issue #40). */
export function findMissingLinkTargets(workflow: Workflow): string[] {
  const missing = new Set<string>();
  for (const node of Object.values(workflow)) {
    for (const value of Object.values(node.inputs)) {
      if (isNodeLink(value) && !workflow[value[0]]) missing.add(value[0]);
    }
  }
  return [...missing];
}

/**
 * Canonical JSON for content-addressing (issue #40): object keys sorted
 * recursively, so the same graph always serializes — and hashes — the same
 * way regardless of key order in the source file.
 */
export function canonicalizeWorkflow(workflow: Workflow): string {
  return canonicalJson(workflow);
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}
