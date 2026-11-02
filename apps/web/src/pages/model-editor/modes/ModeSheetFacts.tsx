import {
  computeModePath,
  relevantInputs,
  resolveModeInputs,
  visibleModeBoundFields,
} from "@ai-content-studio/shared";
import { workflowForMode } from "../helpers/workflow.js";
import type { DraftMode, ModelDetail } from "../types.js";

/**
 * A Mode sheet's Path facts and live form preview (issue #48 AC3): what
 * the Mode's Path resolves to against the current Workflow, and what
 * its Workbench form would show right now (relevant Inputs, labelled
 * and marked required per this Mode's own settings, with fixed ones
 * called out separately), kept live as the Admin edits the grid.
 */
export function ModeSheetFacts({
  mode,
  detail,
}: {
  mode: DraftMode;
  detail: ModelDetail;
}) {
  if (mode.outputNodeIds.length === 0) {
    return <p>Path: pick at least one output node to see its facts.</p>;
  }

  const inputs = detail.inputs ?? [];
  const unresolvable = visibleModeBoundFields(mode.inputSettings ?? [], inputs);
  const workflow = workflowForMode(mode, inputs, detail.workflow);
  const path = computeModePath(workflow, mode.outputNodeIds, unresolvable);
  const relevant = relevantInputs(
    inputs,
    workflow,
    mode.outputNodeIds,
    unresolvable,
  );
  const { formInputs, requiredIds, fixedValues } = resolveModeInputs(
    relevant,
    mode.inputSettings ?? [],
  );

  return (
    <div>
      <p>
        Path: {path.nodeIds.size} node{path.nodeIds.size === 1 ? "" : "s"}
        {path.missingOutputNodeIds.length > 0 &&
          " — an output node is missing from the Workflow!"}
      </p>
      <h4>Form preview</h4>
      {formInputs.length === 0 ? (
        <p>No Inputs show on this Mode's form.</p>
      ) : (
        <ul>
          {formInputs.map((input) => (
            <li key={input.id}>
              {input.label}
              {requiredIds.has(input.id) && " (required)"}
            </li>
          ))}
        </ul>
      )}
      {Object.keys(fixedValues).length > 0 && (
        <p>{Object.keys(fixedValues).length} Input(s) fixed to a value.</p>
      )}
    </div>
  );
}
