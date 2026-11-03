import {
  type InputDefinition,
  type WorkbenchInput,
  relevantInputs,
  resolveModeInputs,
  toWorkbenchInput,
  visibleModeBoundFields,
} from "@ai-content-studio/shared";
// TODO #192: move the Workbench imports into components/inputs/ once #192 merges.
import {
  InputField,
  PointsPickers,
  UPLOAD_KINDS,
  type UploadState,
  type ImageUploadInput as WorkbenchImageUploadInput,
  type MediaUploadInput as WorkbenchMediaUploadInput,
  type PointsInput as WorkbenchPointsInput,
  YourFiles,
  YourMedia,
} from "../../WorkbenchPage.js";
import { workflowForMode } from "../helpers/workflow.js";
import type { AttachedBackendEntry, DraftMode, ModelDetail } from "../types.js";
/**
 * A Mode's test form (issue #74): the editor's own unsaved Mode and
 * Inputs, run against Any or one chosen attached Backend — on an
 * unnumbered revision that never becomes current, blocked only while
 * the Mode has an error. Issue #74 CEO review: an Upload or Points
 * Input reuses the Workbench's own picker (`YourFiles`/`YourMedia`/
 * `PointsPickers`), the rest the Workbench's own `InputField`, so "any
 * Mode" (the AC) really does include one with an Upload.
 */
export function TestPanel({
  mode,
  detail,
  inputsDraft,
  attachedBackends,
  values,
  onValuesChange,
  uploads,
  onPick,
  trimRangeByInputId,
  onTrimRangeChange,
  backendId,
  onBackendIdChange,
  submitting,
  errors,
  onSubmit,
}: {
  mode: DraftMode;
  detail: ModelDetail;
  inputsDraft: InputDefinition[];
  attachedBackends: AttachedBackendEntry[] | null;
  values: Record<string, string>;
  onValuesChange: (values: Record<string, string>) => void;
  uploads: Record<string, UploadState>;
  onPick: (
    input: WorkbenchImageUploadInput | WorkbenchMediaUploadInput,
    file: File,
  ) => void;
  trimRangeByInputId: Record<string, { startMs: number; endMs: number }>;
  onTrimRangeChange: (
    inputId: string,
    range: { startMs: number; endMs: number },
  ) => void;
  backendId: string;
  onBackendIdChange: (id: string) => void;
  submitting: boolean;
  errors: string[] | null;
  onSubmit: () => void;
}) {
  const unresolvable = visibleModeBoundFields(
    mode.inputSettings ?? [],
    inputsDraft,
  );
  const workflow = workflowForMode(mode, inputsDraft, detail.workflow);
  const relevant =
    mode.outputNodeIds.length === 0
      ? []
      : relevantInputs(inputsDraft, workflow, mode.outputNodeIds, unresolvable);
  const { formInputs, requiredIds } = resolveModeInputs(
    relevant,
    mode.inputSettings ?? [],
  );
  const workbenchInputs: WorkbenchInput[] = formInputs.map((input) =>
    toWorkbenchInput(input, workflow, requiredIds.has(input.id), formInputs),
  );
  const imageInputs = workbenchInputs.filter(
    (input): input is WorkbenchImageUploadInput =>
      input.kind === "image_upload",
  );
  const mediaInputs = workbenchInputs.filter(
    (input): input is WorkbenchMediaUploadInput =>
      input.kind === "video_upload" || input.kind === "audio_upload",
  );
  const pointsInputs = workbenchInputs.filter(
    (input): input is WorkbenchPointsInput => input.kind === "points",
  );
  const plainInputs = workbenchInputs.filter(
    (input) => !UPLOAD_KINDS.has(input.kind) && input.kind !== "points",
  );
  function setValue(inputId: string, value: string) {
    onValuesChange({ ...values, [inputId]: value });
  }
  return (
    <section aria-label={`Test ${mode.name || "this Mode"}`}>
      {mode.outputNodeIds.length === 0 && (
        <p role="alert">Pick at least one output node before testing.</p>
      )}
      <label htmlFor={`test-backend-${mode.key}`}>Backend</label>
      <select
        id={`test-backend-${mode.key}`}
        value={backendId}
        onChange={(event) => onBackendIdChange(event.target.value)}
      >
        <option value="">Any</option>
        {(attachedBackends ?? []).map((entry) => (
          <option key={entry.backend.id} value={entry.backend.id}>
            {entry.backend.name}
          </option>
        ))}
      </select>
      <YourFiles
        inputs={imageInputs}
        uploads={uploads}
        issuesByInputId={{}}
        onPick={onPick}
      />
      <YourMedia
        inputs={mediaInputs}
        uploads={uploads}
        trimRangeByInputId={trimRangeByInputId}
        onTrimRangeChange={onTrimRangeChange}
        issuesByInputId={{}}
        onPick={onPick}
      />
      <PointsPickers
        inputs={pointsInputs}
        allInputs={workbenchInputs}
        uploads={uploads}
        trimRangeByInputId={trimRangeByInputId}
        values={values}
        onPointsChange={(inputId, raw) => setValue(inputId, raw)}
        issuesByInputId={{}}
      />
      {plainInputs.map((input) => (
        <InputField
          key={input.id}
          input={input}
          value={values[input.id] ?? ""}
          onChange={(value) => setValue(input.id, value)}
          issue={undefined}
        />
      ))}
      <button
        type="button"
        disabled={submitting || mode.outputNodeIds.length === 0}
        onClick={onSubmit}
      >
        Run test
      </button>
      {errors && (
        <ul role="alert">
          {errors.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
