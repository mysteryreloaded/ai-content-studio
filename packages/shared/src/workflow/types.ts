/** A link from a node field to another node's output: [sourceNodeId, outputIndex]. */
export type NodeLink = [string, number];

/** A value a Workflow node field can hold directly, rather than a link. */
export type NodeFieldValue = string | number | boolean | null;

export type NodeInputs = Record<string, NodeLink | NodeFieldValue>;

/** One node of an API-format ComfyUI Workflow. */
export interface WorkflowNode {
  class_type: string;
  inputs: NodeInputs;
  _meta?: { title?: string };
}

/** An API-format ComfyUI Workflow: node id -> node. Node ids may be subgraph ids like "405:370". */
export type Workflow = Record<string, WorkflowNode>;

export function isNodeLink(
  value: NodeLink | NodeFieldValue,
): value is NodeLink {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === "string" &&
    typeof value[1] === "number"
  );
}
