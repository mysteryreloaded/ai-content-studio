import type { WorkbenchInput } from "@ai-content-studio/shared";

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
