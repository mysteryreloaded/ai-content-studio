import type {
  InputDefinition,
  ModeInputSetting,
} from "@ai-content-studio/shared";
import { useMutation } from "@tanstack/react-query";
import { type ResponseLike, api, ok } from "../../../lib/api.js";

export interface SaveDraftBody {
  version: number;
  details: {
    name: string;
    slug: string;
    description: string;
    maxRunTimeMinutes: number;
  };
  terms: {
    termsBody: string;
    licenseUrl: string;
    attribution: string;
    askAgain: boolean;
  };
  workflow?: {
    json: unknown;
    rebind?: { nodeId: string; newNodeId: string }[];
  };
  inputs: InputDefinition[];
  modes: {
    name: string;
    description: string;
    outputNodeIds: string[];
    inputSettings: ModeInputSetting[];
  }[];
  disable: boolean;
}

/**
 * The server parses `workflow.json` itself (arbitrary JSON, not a
 * zod-validated shape), so `hc` never generates a typed `json` input
 * for it the way it does for the other PUTs (same as the old
 * Replace-Workflow-only PUT this replaced, issue #214).
 */
type UntypedPut = (args: {
  param: { id: string };
  json: SaveDraftBody;
}) => Promise<ResponseLike>;

/**
 * The header Save's one PUT (issue #218): the whole editor draft —
 * Details, Terms, an optional re-uploaded Workflow, Inputs and Modes —
 * in one request, replacing the old chain of per-section PUTs (#213)
 * and the separate "Replace Workflow" PUT (#214).
 */
export function useSaveDraftMutation(modelId: string | undefined) {
  const put = api.api.admin.models[":id"].draft.$put as unknown as UntypedPut;
  return useMutation({
    mutationFn: (body: SaveDraftBody) =>
      ok(put({ param: { id: modelId as string }, json: body })),
  });
}
