import {
  computeModePath,
  findOutsideServiceNotes,
  modeInputSetting,
} from "@ai-content-studio/shared";
import type { ModelIssue } from "@ai-content-studio/shared";
import { Pill } from "../../../components/ui/pill.js";
import {
  nodeGroup,
  visibleBoundFieldsFor,
  workflowForMode,
} from "../helpers/workflow.js";
import type { DraftMode, ModelDetail } from "../types.js";
import { ChecksList } from "../ui/ChecksList.js";

/**
 * A Mode sheet's "Path" facts (issue #216): how many of the Workflow's
 * nodes this Mode sends, a pill per Upload loader on its Path, a note
 * about an outside-service node with no key, and that Mode's own
 * checks.
 */
export function ModeSheetFacts({
  mode,
  detail,
  modelIssues,
  onJump,
}: {
  mode: DraftMode;
  detail: ModelDetail;
  modelIssues: ModelIssue[];
  onJump: (issue: ModelIssue) => void;
}) {
  const inputs = detail.inputs ?? [];
  if (mode.outputNodeIds.length === 0) {
    return (
      <div className="flex flex-col gap-2">
        <h4 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          Path
        </h4>
        <p className="text-[12.5px] text-muted-foreground">
          Pick at least one output node to see its facts.
        </p>
      </div>
    );
  }

  const workflow = workflowForMode(mode, inputs, detail.workflow);
  const path = computeModePath(
    workflow,
    mode.outputNodeIds,
    visibleBoundFieldsFor(mode, inputs),
  );
  const totalNodes = Object.keys(detail.workflow).length;

  const loaderPills = [...path.nodeIds]
    .map((nodeId) => ({ nodeId, node: workflow[nodeId] }))
    .filter(
      ({ node }) => node && nodeGroup(node.class_type) === "Upload loaders",
    )
    .map(({ nodeId, node }) => {
      const input = inputs.find((candidate) =>
        candidate.bindings.some((binding) => binding.nodeId === nodeId),
      );
      const setting = input
        ? modeInputSetting(mode.inputSettings, input.id)
        : null;
      const err = !input || setting?.state === "hidden";
      const loaderTitle = node?._meta?.title ?? node?.class_type ?? nodeId;
      const label = input
        ? `${loaderTitle} → ${input.label || "this Input"} (${setting?.state ?? "optional"})`
        : `${loaderTitle} → no Input`;
      return { nodeId, label, err };
    });

  const outsideServiceNote = findOutsideServiceNotes(workflow).find(
    (note) => path.nodeIds.has(note.nodeId) && !note.keySet,
  );
  const outsideServiceNode = outsideServiceNote
    ? workflow[outsideServiceNote.nodeId]
    : null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        <h4 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          Path
        </h4>
        <p className="text-[13px]">
          <strong>{path.nodeIds.size}</strong> of {totalNodes} nodes are sent to
          the Backend for this Mode.
        </p>
        {loaderPills.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {loaderPills.map(({ nodeId, label, err }) => (
              <Pill key={nodeId} tone={err ? "err" : "neutral"}>
                {label}
              </Pill>
            ))}
          </div>
        )}
        {outsideServiceNode && (
          <p className="text-[12.5px] text-warn">
            {outsideServiceNode._meta?.title ?? outsideServiceNote?.classType}{" "}
            can call an outside service. Its key field is empty, so prompts stay
            on the Backend.
          </p>
        )}
      </div>
      <ChecksList
        issues={modelIssues}
        title="This Mode"
        filter={(issue) => issue.modeId === mode.key}
        onJump={onJump}
      />
    </div>
  );
}
