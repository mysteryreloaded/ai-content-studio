import type { WorkbenchInput } from "@ai-content-studio/shared";
import type { WorkbenchMode } from "../../pages/workbench/types.js";
import { InputField } from "./InputField.js";
import { PointsField } from "./PointsField.js";
import { UploadField } from "./UploadField.js";
import {
  type ImageUploadInput,
  type MediaUploadInput,
  type PointsInput,
  type TrimRange,
  UPLOAD_KINDS,
  type UploadState,
  videoInputIdsUsedByPoints,
} from "./types.js";

type Kind = "files" | "describe" | "settings";

const GROUP_LABELS: Record<Kind, string> = {
  files: "Your files",
  describe: "Describe it",
  settings: "Settings",
};
const GROUP_ORDER: Kind[] = ["files", "describe", "settings"];

/** The three Input groups, by kind rather than the Admin-set `input.group` (issue #194 story 21). */
function kindOf(input: WorkbenchInput): Kind {
  if (UPLOAD_KINDS.has(input.kind) || input.kind === "points") return "files";
  if (input.kind === "text") return "describe";
  return "settings";
}

interface InputGroupsProps {
  mode: WorkbenchMode;
  values: Record<string, string>;
  setValues: (
    update: (current: Record<string, string>) => Record<string, string>,
  ) => void;
  issuesByInputId: Record<string, string>;
  uploads: Record<string, UploadState>;
  trimRangeByInputId: Record<string, TrimRange>;
  onTrimRangeChange: (inputId: string, range: TrimRange) => void;
  onPick: (
    input: ImageUploadInput | MediaUploadInput,
    file: File,
    needsPlayableVideo: boolean,
  ) => void;
  onClearUpload: (input: ImageUploadInput | MediaUploadInput) => void;
  onPointsChange: (inputId: string, raw: string) => void;
}

/** The Workbench's Inputs, grouped by kind in the Model's Input order (issue #194), each a `fieldset` with an eyebrow `legend`. An empty group isn't rendered. */
export function InputGroups({
  mode,
  values,
  setValues,
  issuesByInputId,
  uploads,
  trimRangeByInputId,
  onTrimRangeChange,
  onPick,
  onClearUpload,
  onPointsChange,
}: InputGroupsProps) {
  function setValue(inputId: string, value: string) {
    setValues((current) => ({ ...current, [inputId]: value }));
  }
  const videoIdsUsedByPoints = videoInputIdsUsedByPoints(mode.inputs);

  return (
    <>
      {GROUP_ORDER.map((group) => {
        const inputs = mode.inputs.filter((input) => kindOf(input) === group);
        if (inputs.length === 0) return null;
        return (
          <fieldset
            key={group}
            className="m-0 flex min-w-0 flex-col gap-3.5 border-0 p-0"
          >
            <legend className="pb-2 text-xs leading-tight font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              {GROUP_LABELS[group]}
            </legend>
            {group === "files"
              ? inputs.map((input) => {
                  if (UPLOAD_KINDS.has(input.kind)) {
                    const uploadInput = input as
                      | ImageUploadInput
                      | MediaUploadInput;
                    const needsPlayableVideo =
                      uploadInput.kind === "video_upload" &&
                      (uploadInput.trimmable ||
                        videoIdsUsedByPoints.has(uploadInput.id));
                    return (
                      <UploadField
                        key={input.id}
                        input={uploadInput}
                        upload={uploads[input.id]}
                        trimRange={trimRangeByInputId[input.id]}
                        onTrimRangeChange={(range) =>
                          onTrimRangeChange(input.id, range)
                        }
                        onPick={(file) =>
                          onPick(uploadInput, file, needsPlayableVideo)
                        }
                        onClear={() => onClearUpload(uploadInput)}
                        needsPlayableVideo={needsPlayableVideo}
                        issue={issuesByInputId[input.id]}
                      />
                    );
                  }
                  return (
                    <PointsField
                      key={input.id}
                      input={input as PointsInput}
                      allInputs={mode.inputs}
                      uploads={uploads}
                      trimRangeByInputId={trimRangeByInputId}
                      values={values}
                      onPointsChange={onPointsChange}
                      issue={issuesByInputId[input.id]}
                    />
                  );
                })
              : inputs.map((input) => (
                  <InputField
                    key={input.id}
                    input={input}
                    value={values[input.id] ?? ""}
                    onChange={(value) => setValue(input.id, value)}
                    issue={issuesByInputId[input.id]}
                  />
                ))}
          </fieldset>
        );
      })}
    </>
  );
}
