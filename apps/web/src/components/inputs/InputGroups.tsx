import type { WorkbenchInput } from "@ai-content-studio/shared";
import { InputField } from "./InputField.js";
import { UPLOAD_KINDS } from "./types.js";
import type { WorkbenchMode } from "../../pages/workbench/types.js";

interface InputGroupsProps {
  mode: WorkbenchMode;
  values: Record<string, string>;
  setValues: (
    update: (current: Record<string, string>) => Record<string, string>,
  ) => void;
  issuesByInputId: Record<string, string>;
}

const GROUP_LABELS: Record<WorkbenchInput["group"], string> = {
  describe: "Describe it",
  settings: "Settings",
};

/** The Workbench's Inputs, grouped as Describe it and Settings, in the Admin's order (issue #46). */
export function InputGroups({
  mode,
  values,
  setValues,
  issuesByInputId,
}: InputGroupsProps) {
  function setValue(inputId: string, value: string) {
    setValues((current) => ({ ...current, [inputId]: value }));
  }

  return (
    <>
      {(["describe", "settings"] as const).map((group) => {
        const inputs = mode.inputs.filter(
          (input) =>
            input.group === group &&
            !UPLOAD_KINDS.has(input.kind) &&
            input.kind !== "points",
        );
        if (inputs.length === 0) return null;
        return (
          <fieldset key={group}>
            <legend>{GROUP_LABELS[group]}</legend>
            {inputs.map((input) => (
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
