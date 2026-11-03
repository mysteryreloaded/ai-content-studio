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
 *
 * A node without a `class_type` is usually one ComfyUI exported while the
 * exporting machine was missing that node's custom node pack (issue #229);
 * those are collected across the whole Workflow and named by pack in the
 * single error they produce.
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

  const missingType: { id: string; meta: unknown }[] = [];
  const typed: {
    id: string;
    classType: string;
    node: Record<string, unknown>;
  }[] = [];
  for (const [id, raw] of entries) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return { ok: false, error: `node "${id}" is not an object` };
    }
    const node = raw as Record<string, unknown>;
    if (typeof node.class_type === "string" && node.class_type.length > 0) {
      typed.push({ id, classType: node.class_type, node });
    } else {
      missingType.push({ id, meta: node._meta });
    }
  }

  // Missing-type errors are checked after every node so one error can name
  // every affected pack; they win over a missing `inputs` in the same file.
  if (missingType.length > 0) {
    return { ok: false, error: describeMissingType(missingType) };
  }

  const workflow: Workflow = {};
  for (const { id, classType, node } of typed) {
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
      class_type: classType,
      inputs: node.inputs as NodeInputs,
      ...(meta ? { _meta: meta } : {}),
    };
  }
  return { ok: true, workflow };
}

/** The shared fix line: re-export after installing the packs (issue #229). */
const MISSING_PACKS_FIX =
  "Install them in that ComfyUI (Manager → Install Missing Custom Nodes), restart it, open the Workflow again with no red nodes, and use Export (API) again. The GPU Backends that run this Model need the same packs.";

function hasMeta(meta: unknown): boolean {
  return !!meta && typeof meta === "object";
}

/** Pack for a node exported without its `class_type`: `_meta.cnr_id`, else `_meta.aux_id`, else unknown (issue #229). */
function packOf(meta: unknown): string {
  if (!hasMeta(meta)) {
    return "an unknown custom node pack";
  }
  const record = meta as { cnr_id?: unknown; aux_id?: unknown };
  if (typeof record.cnr_id === "string" && record.cnr_id.length > 0) {
    return record.cnr_id;
  }
  if (typeof record.aux_id === "string" && record.aux_id.length > 0) {
    return record.aux_id;
  }
  return "an unknown custom node pack";
}

function titleOf(meta: unknown): string {
  if (!hasMeta(meta)) {
    return "";
  }
  const title = (meta as { title?: unknown }).title;
  if (typeof title !== "string" || title.length === 0) {
    return "";
  }
  // Keeps one node's line (and thus the whole message) bounded.
  return title.length > 40 ? `${title.slice(0, 39)}…` : title;
}

/** One node as it appears in the message: its id, plus its title when set. */
function nodeRef(id: string, meta: unknown): string {
  const title = titleOf(meta);
  return title ? `${id} "${title}"` : id;
}

/** Node ids in numeric order (non-numeric ids last, then by string). */
function sortNodeIds(
  nodes: { id: string; meta: unknown }[],
): { id: string; meta: unknown }[] {
  const rank = (id: string) =>
    /^\d+$/.test(id) ? Number(id) : Number.POSITIVE_INFINITY;
  return [...nodes].sort((a, b) => {
    const delta = rank(a.id) - rank(b.id);
    if (delta !== 0) return delta;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/**
 * The single error for nodes without a `class_type` (issue #229): ComfyUI
 * still exports them when the machine is missing their custom node packs,
 * so name every pack and how to fix it. At most 3 nodes per pack, then
 * "+N more", so a Workflow with many such nodes stays under ~600 characters.
 */
function describeMissingType(nodes: { id: string; meta: unknown }[]): string {
  const first = nodes[0];
  if (first && nodes.length === 1 && !hasMeta(first.meta)) {
    return `node "${first.id}" has no node type (class_type); export the Workflow with Export (API) from a ComfyUI that has all its custom nodes installed`;
  }

  const byPack = new Map<string, { id: string; meta: unknown }[]>();
  for (const node of nodes) {
    const pack = packOf(node.meta);
    const list = byPack.get(pack) ?? [];
    list.push(node);
    byPack.set(pack, list);
  }

  const packs = [...byPack.keys()].sort((a, b) => {
    const lowerA = a.toLowerCase();
    const lowerB = b.toLowerCase();
    return lowerA < lowerB ? -1 : lowerA > lowerB ? 1 : 0;
  });

  const parts = packs.map((pack) => {
    const list = sortNodeIds(byPack.get(pack) ?? []);
    const shown = list.slice(0, 3).map((node) => nodeRef(node.id, node.meta));
    const refs =
      list.length > 3 ? [...shown, `+${list.length - 3} more`] : shown;
    return `${pack} (${refs.length === 1 ? "node" : "nodes"} ${refs.join(", ")})`;
  });

  const lead =
    nodes.length === 1
      ? "1 node has no node type because the ComfyUI this was exported from is missing its custom node pack: "
      : `${nodes.length} nodes have no node type because the ComfyUI this was exported from is missing their custom node packs: `;
  return `${lead}${parts.join(", ")}. ${MISSING_PACKS_FIX}`;
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
