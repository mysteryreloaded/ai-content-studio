import type { WorkbenchInput } from "@ai-content-studio/shared";

export type ImageUploadInput = Extract<
  WorkbenchInput,
  { kind: "image_upload" }
>;
export type VideoUploadInput = Extract<
  WorkbenchInput,
  { kind: "video_upload" }
>;
export type AudioUploadInput = Extract<
  WorkbenchInput,
  { kind: "audio_upload" }
>;
export type MediaUploadInput = VideoUploadInput | AudioUploadInput;
export type PointsInput = Extract<WorkbenchInput, { kind: "points" }>;

export const UPLOAD_KINDS = new Set<WorkbenchInput["kind"]>([
  "image_upload",
  "video_upload",
  "audio_upload",
]);

/** One Upload Input's file (issues #50, #51): uploading, uploaded, or refused. A video/audio one also carries its playable/trim facts. */
export type UploadState =
  | { status: "uploading"; name: string; progress: number }
  | {
      status: "complete";
      name: string;
      uploadId: string;
      durationMs: number | null;
      browserPlayable: boolean | null;
    }
  | { status: "error"; name: string; message: string };

export type TrimRange = { startMs: number; endMs: number };

export interface PointsPickersProps {
  inputs: PointsInput[];
  allInputs: WorkbenchInput[];
  uploads: Record<string, UploadState>;
  trimRangeByInputId: Record<string, TrimRange>;
  values: Record<string, string>;
  onPointsChange: (inputId: string, raw: string) => void;
  issuesByInputId: Record<string, string>;
  /** Drops the own `fieldset`/`legend` for a shared "Your files" group (issue #194). */
  bare?: boolean;
}

export interface PointsFieldProps {
  input: PointsInput;
  allInputs: WorkbenchInput[];
  uploads: Record<string, UploadState>;
  trimRangeByInputId: Record<string, TrimRange>;
  values: Record<string, string>;
  onPointsChange: (inputId: string, raw: string) => void;
  issue: string | undefined;
}
