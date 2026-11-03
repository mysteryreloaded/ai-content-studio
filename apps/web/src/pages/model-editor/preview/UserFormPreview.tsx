import {
  relevantInputs,
  resolveModeInputs,
  toWorkbenchInput,
  visibleModeBoundFields,
} from "@ai-content-studio/shared";
import type { InputDefinition, Workflow } from "@ai-content-studio/shared";
import { useState } from "react";
import { CountPicker } from "../../../components/inputs/CountPicker.js";
import { InputGroups } from "../../../components/inputs/InputGroups.js";
import { Button } from "../../../components/ui/button.js";
import type { DraftMode } from "../types.js";

/**
 * "What users see" (issue #216, variant C): a live, read-only-by-default
 * render of a Mode's Workbench form, built from the real Input controls
 * in `components/inputs/`. `interactive` lets #217 reuse this unchanged
 * as the Test form.
 */
export function UserFormPreview({
  modelName,
  attribution,
  mode,
  inputs,
  workflow,
  interactive = false,
}: {
  modelName: string;
  attribution: string;
  mode: DraftMode;
  inputs: InputDefinition[];
  workflow: Workflow;
  interactive?: boolean;
}) {
  const [values, setValues] = useState<Record<string, string>>({});

  const unresolvable = visibleModeBoundFields(mode.inputSettings ?? [], inputs);
  const relevant =
    mode.outputNodeIds.length === 0
      ? []
      : relevantInputs(inputs, workflow, mode.outputNodeIds, unresolvable);
  const { formInputs, requiredIds } = resolveModeInputs(
    relevant,
    mode.inputSettings ?? [],
  );
  const workbenchInputs = formInputs.map((input) =>
    toWorkbenchInput(input, workflow, requiredIds.has(input.id), formInputs),
  );

  const seedInput = inputs.find((input) => input.kind === "seed");
  const showsCountPicker = Boolean(
    seedInput && relevant.some((input) => input.id === seedInput.id),
  );

  const workbenchMode = {
    id: mode.key,
    name: mode.name,
    description: mode.description,
    inputs: workbenchInputs,
    menuGroup: "prompt" as const,
    hasSeed: showsCountPicker,
  };

  return (
    <div className="flex flex-col gap-3.5 rounded-2xl border border-border bg-background p-3.5">
      <div>
        <h3 className="text-base font-semibold">{modelName}</h3>
        {attribution && (
          <p className="text-[12px] text-muted-foreground">{attribution}</p>
        )}
        <p className="text-[13px] text-muted-foreground">
          {mode.name || "this Mode"}
          {mode.description ? ` · ${mode.description}` : ""}
        </p>
      </div>
      <fieldset
        disabled={!interactive}
        className="m-0 flex flex-col gap-3.5 border-0 p-0"
      >
        {workbenchInputs.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">
            This Mode shows no Inputs. Users only press Generate.
          </p>
        ) : (
          <InputGroups
            mode={workbenchMode}
            values={values}
            setValues={setValues}
            issuesByInputId={{}}
            uploads={{}}
            trimRangeByInputId={{}}
            onTrimRangeChange={() => {}}
            onPick={() => {}}
            onClearUpload={() => {}}
            onPointsChange={(inputId, raw) =>
              setValues((current) => ({ ...current, [inputId]: raw }))
            }
          />
        )}
        {showsCountPicker && (
          <CountPicker count={1} onChange={() => {}} maxCount={4} />
        )}
        <Button type="button" disabled>
          Generate
        </Button>
      </fieldset>
    </div>
  );
}
