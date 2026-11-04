import type {
  InputDefinition,
  ModeInputSetting,
  Workflow,
} from "@ai-content-studio/shared";
import type { GenerationSummary } from "../../components/generations/types.js";
export interface ModelNode {
  id: string;
  classType: string;
  title: string | null;
}
export interface OutsideServiceNote {
  nodeId: string;
  classType: string;
  keySet: boolean;
}
export interface ResolvedOutputNode {
  nodeId: string;
  classType: string;
  title: string | null;
  kind: "video" | "image" | "audio" | null;
}
export interface ModeRecord {
  id: string;
  sortOrder: number;
  name: string;
  description: string;
  outputNodes: ResolvedOutputNode[];
  inputSettings: ModeInputSetting[];
}
export interface DraftMode {
  /** Client-only, stable across re-renders; stripped before saving. */
  key: string;
  name: string;
  description: string;
  outputNodeIds: string[];
  inputSettings: ModeInputSetting[];
}
export interface ModelDetail {
  model: {
    id: string;
    name: string;
    slug: string;
    description: string;
    maxRunTimeMinutes: number;
    state: "enabled" | "disabled";
    currentRevision: number;
    version: number;
    termsBody: string;
    licenseUrl: string;
    attribution: string;
    termsVersion: number | null;
    termsVersionCreatedAt: string | null;
    termsRevision: number;
  };
  workflowHash: string;
  workflow: Workflow;
  nodes: ModelNode[];
  outsideServiceNotes: OutsideServiceNote[];
  modes: ModeRecord[];
  inputs: InputDefinition[];
}
/** A broken binding/output's own node id, repointable by the rebind picker (issue #71, CEO review). */
export interface BrokenNodeRef {
  nodeId: string;
  description: string;
}
/** A Backend's live health (issue #39), as `GET /api/admin/backends` reports it. */
export interface BackendHealth {
  reachability: "unknown" | "reachable" | "unreachable";
  comfyuiVersion: string | null;
  credentialsError: boolean;
}
export interface AdminBackendSummary {
  id: string;
  name: string;
  baseUrl: string;
  enabled: boolean;
  health: BackendHealth;
}
/** `GET /:id/object-info`'s JSON shape (issue #49): a Backend's `/object_info` knowledge, plain enough to send over the wire. */
export interface ObjectInfoBackendJson {
  id: string;
  name: string;
  enabled: boolean;
  reachable: boolean;
  nodeTypes: string[];
  fieldSpecs: Record<string, Record<string, unknown>>;
}
/**
 * One Test run (issue #74/#259), as the `/test` and `/tests` endpoints
 * and the `/api/generations/stream` SSE stream return it: the same
 * shape as any other Generation, so the Test section's result panel
 * can reuse the Workbench's own player, progress and state-pill pieces
 * from `components/generations/` unchanged.
 */
export type TestRun = GenerationSummary;
export interface AttachedBackendEntry {
  backend: AdminBackendSummary;
  reachable: boolean;
  missingNodeTypes: string[] | null;
  note: string | null;
}
export interface DetailsForm {
  name: string;
  slug: string;
  description: string;
  maxRunTimeMinutes: number;
}
export interface ErrorPayload {
  error?: string;
  errors?: { field: string; message: string }[];
}
export interface RevisionSummary {
  revisionNumber: number;
  createdAt: string;
  workflowHash: string;
  modeCount: number;
  inputCount: number;
}
export interface TermsForm {
  termsBody: string;
  licenseUrl: string;
  attribution: string;
}
