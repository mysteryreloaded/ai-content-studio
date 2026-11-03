import { Fragment } from "react";
import type { ElementType } from "react";
import { UploadField } from "./UploadField.js";
import type { ImageUploadInput, UploadState } from "./types.js";

/**
 * The Workbench's Image Upload Inputs (issue #50), always required: a
 * thin wrapper over `UploadField` (issue #197) with its own fieldset/
 * legend, kept so the Model editor's `TestPanel` can render a group of
 * them directly. `bare` (issue #194) drops that fieldset for the shared
 * "Your files" group, where `InputGroups` renders `UploadField` itself.
 */
export function YourFiles({
  inputs,
  uploads,
  issuesByInputId,
  onPick,
  onClear,
  bare = false,
}: {
  inputs: ImageUploadInput[];
  uploads: Record<string, UploadState>;
  issuesByInputId: Record<string, string>;
  onPick: (input: ImageUploadInput, file: File) => void;
  onClear?: (input: ImageUploadInput) => void;
  bare?: boolean;
}) {
  if (inputs.length === 0) return null;
  const Wrapper: ElementType = bare ? Fragment : "fieldset";
  return (
    <Wrapper>
      {!bare && <legend>Your files</legend>}
      {inputs.map((input) => (
        <UploadField
          key={input.id}
          input={input}
          upload={uploads[input.id]}
          trimRange={undefined}
          onTrimRangeChange={() => {}}
          onPick={(file) => onPick(input, file)}
          onClear={() => onClear?.(input)}
          issue={issuesByInputId[input.id]}
        />
      ))}
    </Wrapper>
  );
}
