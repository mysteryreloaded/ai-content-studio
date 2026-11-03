import type { Dispatch, SetStateAction } from "react";
import { CountPicker } from "../../components/inputs/CountPicker.js";
import { InputGroups } from "../../components/inputs/InputGroups.js";
import { PointsPickers } from "../../components/inputs/PointsPickers.js";
import { YourFiles } from "../../components/inputs/YourFiles.js";
import { YourMedia } from "../../components/inputs/YourMedia.js";
import type {
  ImageUploadInput,
  MediaUploadInput,
  PointsInput,
  TrimRange,
  UploadState,
} from "../../components/inputs/types.js";
import { ModeMenu } from "./ModeMenu.js";
import type { SubmitState, WorkbenchMode } from "./types.js";

export function WorkbenchForm({
  modes,
  selectedModeId,
  selectedMode,
  onSelectMode,
  values,
  updateValues,
  uploads,
  trimRangeByInputId,
  setTrimRangeByInputId,
  handlePointsChange,
  displayedIssuesByInputId,
  startUpload,
  hasSeedInput,
  count,
  setCount,
  submitState,
}: {
  modes: WorkbenchMode[];
  selectedModeId: string | null;
  selectedMode: WorkbenchMode | null;
  onSelectMode: (mode: WorkbenchMode) => void;
  values: Record<string, string>;
  updateValues: (
    update: (current: Record<string, string>) => Record<string, string>,
  ) => void;
  uploads: Record<string, UploadState>;
  trimRangeByInputId: Record<string, TrimRange>;
  setTrimRangeByInputId: Dispatch<SetStateAction<Record<string, TrimRange>>>;
  handlePointsChange: (inputId: string, raw: string) => void;
  displayedIssuesByInputId: Record<string, string>;
  startUpload: (input: ImageUploadInput | MediaUploadInput, file: File) => void;
  hasSeedInput: boolean;
  count: number;
  setCount: (count: number) => void;
  submitState: SubmitState;
}) {
  return (
    <section className="workbench-form">
      <ModeMenu
        modes={modes}
        selectedModeId={selectedModeId}
        onSelect={onSelectMode}
      />

      {selectedMode && (
        <YourFiles
          inputs={selectedMode.inputs.filter(
            (input): input is ImageUploadInput => input.kind === "image_upload",
          )}
          uploads={uploads}
          issuesByInputId={displayedIssuesByInputId}
          onPick={(input, file) => void startUpload(input, file)}
        />
      )}

      {selectedMode && (
        <YourMedia
          inputs={selectedMode.inputs.filter(
            (input): input is MediaUploadInput =>
              input.kind === "video_upload" || input.kind === "audio_upload",
          )}
          uploads={uploads}
          trimRangeByInputId={trimRangeByInputId}
          onTrimRangeChange={(inputId, range) =>
            setTrimRangeByInputId((ranges) => ({
              ...ranges,
              [inputId]: range,
            }))
          }
          issuesByInputId={displayedIssuesByInputId}
          onPick={(input, file) => void startUpload(input, file)}
        />
      )}

      {selectedMode && (
        <PointsPickers
          inputs={selectedMode.inputs.filter(
            (input): input is PointsInput => input.kind === "points",
          )}
          allInputs={selectedMode.inputs}
          values={values}
          uploads={uploads}
          trimRangeByInputId={trimRangeByInputId}
          onPointsChange={handlePointsChange}
          issuesByInputId={displayedIssuesByInputId}
        />
      )}

      {selectedMode && (
        <InputGroups
          mode={selectedMode}
          values={values}
          setValues={updateValues}
          issuesByInputId={displayedIssuesByInputId}
        />
      )}

      {hasSeedInput && <CountPicker count={count} onChange={setCount} />}

      {submitState.status === "error" && (
        <p role="alert">{submitState.message}</p>
      )}
    </section>
  );
}
