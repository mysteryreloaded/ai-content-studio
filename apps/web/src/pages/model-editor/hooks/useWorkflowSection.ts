import { useMutation } from "@tanstack/react-query";
import { type ResponseLike, api, ok } from "../../../lib/api.js";

export interface ReplaceWorkflowBody {
  version: number;
  workflow: unknown;
  rebind?: { nodeId: string; newNodeId: string }[];
  disable?: boolean;
}

/**
 * The server parses this route's body itself (`workflow` is arbitrary
 * JSON, not a zod-validated shape), so `hc` never generates a typed
 * `json` input for it the way it does for the other PUTs.
 */
type UntypedPut = (args: {
  param: { id: string };
  json: ReplaceWorkflowBody;
}) => Promise<ResponseLike>;

/**
 * Replace Workflow's own PUT (issue #214), through the typed `api`
 * client instead of a bare `fetch`. The caller (`useModelEditor`) still
 * owns `pendingWorkflow`/`rebindMap` and what happens after a
 * successful replace (reseeding the other drafts, reloading revisions).
 */
export function useReplaceWorkflowMutation(modelId: string | undefined) {
  const put = api.api.admin.models[":id"].workflow
    .$put as unknown as UntypedPut;
  return useMutation({
    mutationFn: (body: ReplaceWorkflowBody) =>
      ok(put({ param: { id: modelId as string }, json: body })),
  });
}
