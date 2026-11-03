import {
  type InputDefinition,
  type Workflow,
  isSeedInput,
  modeMenuGroup,
  relevantInputs,
  resolveModeInputs,
  toWorkbenchInput,
} from "@ai-content-studio/shared";
import { useState } from "react";
import { CountPicker } from "../../../components/inputs/CountPicker.js";
import { InputGroups } from "../../../components/inputs/InputGroups.js";
import { Button } from "../../../components/ui/button.js";
import type { WorkbenchMode } from "../../workbench/types.js";
import { visibleBoundFieldsFor, workflowForMode } from "../helpers/workflow.js";
import type { DraftMode } from "../types.js";

/**
 * The Mode sheet's "What users see" column (issue #216, variant C): a
 * live preview of the Workbench form this Mode would show right now,
 * built from the real `components/inputs/` controls. `interactive`
 * (false here) lets #217 reuse this same component, enabled, as the
 * Test form.
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
  const unresolvable = visibleBoundFieldsFor(mode, inputs);
  const workflowApplied = workflowForMode(mode, inputs, workflow);
  const relevant =
    mode.outputNodeIds.length === 0
      ? []
      : relevantInputs(
          inputs,
          workflowApplied,
          mode.outputNodeIds,
          unresolvable,
        );
  const { formInputs, requiredIds } = resolveModeInputs(
    relevant,
    mode.inputSettings,
  );
  const workbenchInputs = formInputs.map((input) =>
    toWorkbenchInput(
      input,
      workflowApplied,
      requiredIds.has(input.id),
      formInputs,
    ),
  );
  const hasSeed = relevant.some(isSeedInput);
  const workbenchMode: WorkbenchMode = {
    id: mode.key,
    name: mode.name,
    description: mode.description,
    inputs: workbenchInputs,
    menuGroup: modeMenuGroup(relevant, mode.inputSettings),
    hasSeed,
  };

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-border bg-background p-3.5">
      <h3 className="font-heading text-base font-semibold">{modelName}</h3>
      {attribution && (
        <p className="text-[12.5px] text-muted-foreground">{attribution}</p>
      )}
      <p className="text-[13px] text-muted-foreground">
        {mode.name || "Mode"}
        {mode.description ? ` · ${mode.description}` : ""}
      </p>

      <fieldset disabled={!interactive} className="contents">
        {workbenchInputs.length === 0 ? (
          <p className="text-muted-foreground">
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
        {hasSeed && <CountPicker count={1} onChange={() => {}} maxCount={4} />}
        <Button type="button" disabled>
          Generate
        </Button>
      </fieldset>
    </div>
  );
}
