import type { WorkbenchInput } from "@ai-content-studio/shared";
import type { QueryClient } from "@tanstack/react-query";
import type { Dispatch, RefObject, SetStateAction } from "react";
import type { SubmissionSummary } from "../../components/generations/types.js";
import type {
  GenerationProgress,
  SubmissionSummary as Submission,
} from "../../components/generations/types.js";
import type { TrimRange, UploadState } from "../../components/inputs/types.js";

export type ModeMenuGroup = "prompt" | "images" | "audio" | "video";

export interface WorkbenchMode {
  id: string;
  name: string;
  description: string;
  inputs: WorkbenchInput[];
  menuGroup: ModeMenuGroup;
  /** Issue #48 CEO review: true whenever the Mode's Path holds a bound Seed Input, even one this Mode hides. */
  hasSeed: boolean;
}

export interface InputIssue {
  path: string;
  code: string;
  message: string;
}

export interface ModelTerms {
  version: number;
  body: string;
  licenseUrl: string;
  accepted: boolean;
}

export interface WorkbenchModel {
  id: string;
  slug: string;
  name: string;
  description: string;
  revision: number;
  attribution: string;
  terms: ModelTerms | null;
  modes: WorkbenchMode[];
}

export type SubmitState =
  | { status: "idle" }
  /** Issue #50: Generate was pressed while Uploads were still running. */
  | { status: "waiting" }
  /** Issue #51: one trim, covering every Generation in the Submission, runs before it's built. */
  | { status: "trimming" }
  | { status: "submitting" }
  | { status: "error"; message: string };

/** The terms dialog's own state (issue #61): whether it blocks dismissal and the error, if any, to show. */
export type TermsDialogState = { blocking: boolean; error: string | null };

export type RunningUploads = RefObject<
  Map<string, { promise: Promise<void>; controller: AbortController }>
>;

export interface UseGenerateOptions {
  modelRef: RefObject<WorkbenchModel | null>;
  valuesRef: RefObject<Record<string, string>>;
  runningUploadsRef: RunningUploads;
  slug: string;
  queryClient: QueryClient;
  selectedModeId: string | null;
  count: number;
  uploads: Record<string, UploadState>;
  trimRangeByInputId: Record<string, TrimRange>;
  setValues: Dispatch<SetStateAction<Record<string, string>>>;
  setIssuesByInputId: Dispatch<SetStateAction<Record<string, string>>>;
  setSelectedModeId: Dispatch<SetStateAction<string | null>>;
  setTermsDialog: Dispatch<SetStateAction<TermsDialogState | null>>;
  refreshCaps: () => void;
  setSubmissions: Dispatch<SetStateAction<SubmissionSummary[]>>;
  setLastOwnSubmissionId: Dispatch<SetStateAction<string | null>>;
}

export interface WorkbenchFeedProps {
  model: WorkbenchModel;
  submissions: Submission[];
  hasMore: boolean;
  progressById: Map<string, GenerationProgress>;
  paused: boolean;
  lastOwnSubmissionId: string | null;
  cancellingSubmissionIds: Set<string>;
  deletingSubmissionIds: Set<string>;
  cancelErrorSubmissionId: string | null;
  deleteErrorSubmissionId: string | null;
  cancellingGenerationIds: Set<string>;
  deletingGenerationIds: Set<string>;
  handleCancelSubmission: (submissionId: string) => void;
  handleDeleteSubmission: (submissionId: string) => void;
  handleCancelGeneration: (id: string) => void;
  handleDeleteGeneration: (id: string) => void;
  handleDismissGeneration: (id: string) => void;
  setSubmissions: Dispatch<SetStateAction<Submission[]>>;
}
