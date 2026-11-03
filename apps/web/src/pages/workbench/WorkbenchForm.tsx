import type { Dispatch, SetStateAction } from "react";
import { InputGroups } from "../../components/inputs/InputGroups.js";
import type {
  ImageUploadInput,
  MediaUploadInput,
  TrimRange,
  UploadState,
} from "../../components/inputs/types.js";
import { ModeMenu } from "./ModeMenu.js";
import { WorkbenchBanner } from "./WorkbenchBanner.js";
import type { WorkbenchMode } from "./types.js";

export function WorkbenchForm({
  modes,
  selectedModeId,
  selectedMode,
  onSelectMode,
  banner,
  onDismissBanner,
  values,
  updateValues,
  uploads,
  trimRangeByInputId,
  setTrimRangeByInputId,
  handlePointsChange,
  displayedIssuesByInputId,
  startUpload,
}: {
  modes: WorkbenchMode[];
  selectedModeId: string | null;
  selectedMode: WorkbenchMode | null;
  onSelectMode: (mode: WorkbenchMode) => void;
  banner: string | null;
  onDismissBanner: () => void;
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
}) {
  return (
    <>
      <ModeMenu
        modes={modes}
        selectedModeId={selectedModeId}
        onSelect={onSelectMode}
      />

      <WorkbenchBanner banner={banner} onDismiss={onDismissBanner} />

      {selectedMode && (
        <InputGroups
          mode={selectedMode}
          values={values}
          setValues={updateValues}
          issuesByInputId={displayedIssuesByInputId}
          uploads={uploads}
          trimRangeByInputId={trimRangeByInputId}
          onTrimRangeChange={(inputId, range) =>
            setTrimRangeByInputId((ranges) => ({
              ...ranges,
              [inputId]: range,
            }))
          }
          onPick={(input, file) => void startUpload(input, file)}
          onPointsChange={handlePointsChange}
        />
      )}
    </>
  );
}
