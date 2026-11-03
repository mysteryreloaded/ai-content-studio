import { type ElementType, Fragment } from "react";
import { PointsField } from "./PointsField.js";
import type { PointsPickersProps } from "./types.js";

/**
 * The Workbench's Points Inputs (issue #52): a thin wrapper over
 * `PointsField` (issue #197) with its own fieldset/legend, kept so the
 * Model editor's `TestPanel` can render a group of them directly.
 * `bare` (issue #194) drops that fieldset for the shared "Your files"
 * group, where `InputGroups` renders `PointsField` itself.
 */
export function PointsPickers({
  inputs,
  allInputs,
  uploads,
  trimRangeByInputId,
  values,
  onPointsChange,
  issuesByInputId,
  bare = false,
}: PointsPickersProps) {
  if (inputs.length === 0) return null;
  const Wrapper: ElementType = bare ? Fragment : "fieldset";
  return (
    <Wrapper>
      {!bare && <legend>Points</legend>}
      {inputs.map((input) => (
        <PointsField
          key={input.id}
          input={input}
          allInputs={allInputs}
          uploads={uploads}
          trimRangeByInputId={trimRangeByInputId}
          values={values}
          onPointsChange={onPointsChange}
          issue={issuesByInputId[input.id]}
        />
      ))}
    </Wrapper>
  );
}
