import { Fragment } from "react";
import type { ElementType } from "react";
import { UploadField } from "./UploadField.js";
import type { MediaUploadInput, TrimRange, UploadState } from "./types.js";

/**
 * The Workbench's Video/Audio Upload Inputs (issue #51): a thin wrapper
 * over `UploadField` (issue #197) with its own fieldset/legend, kept so
 * the Model editor's `TestPanel` can render a group of them directly.
 * `bare` (issue #194) drops that fieldset for the shared "Your files"
 * group, where `InputGroups` renders `UploadField` itself (and can tell
 * it a video also feeds a Points Input, which `TestPanel` doesn't track).
 */
export function YourMedia({
  inputs,
  uploads,
  trimRangeByInputId,
  onTrimRangeChange,
  issuesByInputId,
  onPick,
  onClear,
  bare = false,
}: {
  inputs: MediaUploadInput[];
  uploads: Record<string, UploadState>;
  trimRangeByInputId: Record<string, TrimRange>;
  onTrimRangeChange: (inputId: string, range: TrimRange) => void;
  issuesByInputId: Record<string, string>;
  onPick: (input: MediaUploadInput, file: File) => void;
  onClear?: (input: MediaUploadInput) => void;
  bare?: boolean;
}) {
  if (inputs.length === 0) return null;
  const Wrapper: ElementType = bare ? Fragment : "fieldset";
  return (
    <Wrapper>
      {!bare && <legend>Your media</legend>}
      {inputs.map((input) => (
        <UploadField
          key={input.id}
          input={input}
          upload={uploads[input.id]}
          trimRange={trimRangeByInputId[input.id]}
          onTrimRangeChange={(range) => onTrimRangeChange(input.id, range)}
          onPick={(file) => onPick(input, file)}
          onClear={() => onClear?.(input)}
          needsPlayableVideo={input.kind === "video_upload" && input.trimmable}
          issue={issuesByInputId[input.id]}
        />
      ))}
    </Wrapper>
  );
}
