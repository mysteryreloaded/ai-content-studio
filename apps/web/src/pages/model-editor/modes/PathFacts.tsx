import { computeModePath, modeInputSetting } from "@ai-content-studio/shared";
import type { InputDefinition } from "@ai-content-studio/shared";
import { Pill } from "../../../components/ui/pill.js";
import {
  nodeGroup,
  visibleBoundFieldsFor,
  workflowForMode,
} from "../helpers/workflow.js";
import type { DraftMode, ModelDetail } from "../types.js";

/**
 * A Mode sheet's Path facts (issue #216): how many of the Workflow's
 * nodes this Mode sends to the Backend, one pill per Upload loader on
 * its Path naming the Input that fills it, and a note when the Path
 * holds an outside-service node whose key field is empty.
 */
export function PathFacts({
  mode,
  detail,
  inputs,
}: {
  mode: DraftMode;
  detail: ModelDetail;
  inputs: InputDefinition[];
}) {
  if (mode.outputNodeIds.length === 0) {
    return (
      <p className="text-muted-foreground">
        Pick at least one output node to see its Path.
      </p>
    );
  }

  const workflow = workflowForMode(mode, inputs, detail.workflow);
  const unresolvable = visibleBoundFieldsFor(mode, inputs);
  const path = computeModePath(workflow, mode.outputNodeIds, unresolvable);
  const total = Object.keys(detail.workflow).length;

  const loaderNodeIds = [...path.nodeIds].filter((nodeId) => {
    const classType = workflow[nodeId]?.class_type;
    return classType !== undefined && nodeGroup(classType) === "Upload loaders";
  });

  const outsideServiceOnPath = detail.outsideServiceNotes.filter(
    (note) => path.nodeIds.has(note.nodeId) && !note.keySet,
  );

  return (
    <div className="flex flex-col gap-2">
      <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        Path
      </div>
      <p>
        <strong>{path.nodeIds.size}</strong> of {total} nodes are sent to the
        Backend for this Mode.
      </p>

      {loaderNodeIds.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {loaderNodeIds.map((nodeId) => {
            const classType = workflow[nodeId]?.class_type ?? "";
            const title =
              detail.nodes.find((n) => n.id === nodeId)?.title ?? classType;
            const input = inputs.find((candidate) =>
              candidate.bindings.some((binding) => binding.nodeId === nodeId),
            );
            const state = input
              ? modeInputSetting(mode.inputSettings, input.id).state
              : null;
            const isErr = !input || state === "hidden";
            return (
              <Pill key={nodeId} tone={isErr ? "err" : "neutral"}>
                {title} → {input ? input.label : "no Input"}
                {state ? ` (${state})` : ""}
              </Pill>
            );
          })}
        </div>
      )}

      {outsideServiceOnPath.map((note) => {
        const title =
          detail.nodes.find((n) => n.id === note.nodeId)?.title ??
          note.classType;
        return (
          <p
            key={note.nodeId}
            className="rounded-r-md border border-border border-l-[3px] border-l-warn px-3 py-2 text-[13px]"
          >
            {title} can call an outside service. Its key field is empty, so
            prompts stay on the Backend.
          </p>
        );
      })}
    </div>
  );
}
