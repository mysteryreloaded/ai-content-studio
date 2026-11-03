import {
  type InputDefinition,
  type ModeInputSetting,
  type ModelIssue,
  type Workflow,
  computeModePath,
  modeInputSetting,
} from "@ai-content-studio/shared";
import { cn } from "cn";
import {
  boundNodeIds,
  visibleBoundFieldsFor,
  workflowForMode,
} from "../helpers/workflow.js";
import type { DraftMode } from "../types.js";
import { StateChip } from "../ui/StateChip.js";
import { TypeDot, typeDotKindFor } from "../ui/TypeDot.js";
import { CellPopover } from "./CellPopover.js";

const UPLOAD_KINDS = new Set<InputDefinition["kind"]>([
  "image_upload",
  "video_upload",
  "audio_upload",
]);

/**
 * The Input x Mode grid (issue #216, variant A): a state chip per cell,
 * opened for editing in a popover (no row menus, no multi-select). One
 * row per Input in the Model's order, plus a leading "Output (main
 * Asset)" row per Mode.
 */
export function ModeInputGrid({
  modes,
  inputs,
  workflow,
  modelIssues,
  onChange,
  onApplyToEveryEligibleMode,
  onOpenMode,
  onOpenInput,
  openCell,
}: {
  modes: DraftMode[];
  inputs: InputDefinition[];
  workflow: Workflow;
  modelIssues: ModelIssue[];
  onChange: (
    modeIndex: number,
    inputId: string,
    patch: Partial<ModeInputSetting>,
  ) => void;
  onApplyToEveryEligibleMode: (
    modeIndex: number,
    input: InputDefinition,
  ) => void;
  onOpenMode: (mode: DraftMode) => void;
  onOpenInput: (inputId: string) => void;
  openCell?: { modeKey: string; inputId: string } | null;
}) {
  // The corner, Mode column heads and the output row always render (a
  // Mode's name opens its sheet even before the Model has any Inputs);
  // only the per-Input rows below need at least one Input.
  const pathByMode = new Map(
    modes.map((mode) => [
      mode.key,
      mode.outputNodeIds.length > 0
        ? computeModePath(
            workflowForMode(mode, inputs, workflow),
            mode.outputNodeIds,
            visibleBoundFieldsFor(mode, inputs),
          )
        : null,
    ]),
  );

  return (
    <div className="flex flex-col gap-2">
      <div className="max-h-[calc(100vh-230px)] overflow-auto rounded-xl border border-border bg-card">
        <table className="border-separate border-spacing-0 text-[12.5px]">
          <thead>
            <tr>
              <th className="sticky top-0 left-0 z-[4] min-w-[190px] border-b border-r border-border bg-card px-1.5 py-[5px] text-left align-bottom text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                Input ↓ · Mode →
              </th>
              {modes.map((mode, i) => {
                const path = pathByMode.get(mode.key) ?? null;
                const uploadKinds = inputs
                  .filter(
                    (input) =>
                      UPLOAD_KINDS.has(input.kind) &&
                      path &&
                      [...boundNodeIds(input)].some((id) =>
                        path.nodeIds.has(id),
                      ),
                  )
                  .map((input) => ({
                    id: input.id,
                    kind: typeDotKindFor(input.kind),
                  }));
                const errorCount = modelIssues.filter(
                  (issue) =>
                    issue.modeId === mode.key && issue.severity === "error",
                ).length;
                return (
                  <th
                    key={mode.key}
                    className="sticky top-0 z-[3] min-w-[112px] max-w-[132px] border-b border-r border-border bg-card px-1.5 py-[5px] text-left align-bottom font-semibold"
                  >
                    <button
                      type="button"
                      className="break-words text-left underline-offset-2 hover:underline"
                      onClick={() => onOpenMode(mode)}
                    >
                      {mode.name || `Mode ${i + 1}`}
                    </button>
                    <div className="mt-1 flex items-center gap-1">
                      {uploadKinds.map(({ id, kind }) => (
                        <TypeDot key={id} kind={kind} />
                      ))}
                      {errorCount > 0 && (
                        <span className="text-[11px] font-semibold text-err">
                          {errorCount} error{errorCount === 1 ? "" : "s"}
                        </span>
                      )}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            <tr>
              <th
                scope="row"
                className="sticky left-0 z-[2] min-w-[190px] border-r border-border bg-muted px-1.5 py-[5px] text-left font-medium"
              >
                Output (main Asset)
              </th>
              {modes.map((mode) => {
                const [main, ...extra] = mode.outputNodeIds;
                const missing =
                  main !== undefined && !workflow[main] ? main : null;
                return (
                  <td
                    key={mode.key}
                    className="border-r border-border bg-muted px-1.5 py-[5px] font-mono text-[11.5px]"
                  >
                    {main === undefined ? (
                      <span className="text-err">none</span>
                    ) : missing ? (
                      <span className="text-err">#{missing} missing</span>
                    ) : (
                      <>
                        #{main}
                        {extra.length > 0 && (
                          <span className="ml-1 text-muted-foreground">
                            +{extra.length}
                          </span>
                        )}
                      </>
                    )}
                  </td>
                );
              })}
            </tr>
            {inputs.map((input) => (
              <tr key={input.id}>
                <th
                  scope="row"
                  className="sticky left-0 z-[2] min-w-[190px] border-b border-r border-border bg-card px-1.5 py-[5px] text-left font-medium"
                >
                  <button
                    type="button"
                    className="flex w-full items-center gap-1.5 rounded-sm px-1 py-0.5 text-left hover:bg-muted"
                    onClick={() => onOpenInput(input.id)}
                  >
                    <TypeDot kind={typeDotKindFor(input.kind)} />
                    <span className="truncate">
                      {input.label || "Untitled Input"}
                    </span>
                  </button>
                </th>
                {modes.map((mode, modeIndex) => {
                  const path = pathByMode.get(mode.key);
                  const onPath = Boolean(
                    path &&
                      [...boundNodeIds(input)].some((id) =>
                        path.nodeIds.has(id),
                      ),
                  );
                  const setting = modeInputSetting(
                    mode.inputSettings,
                    input.id,
                  );
                  const hasErr = modelIssues.some(
                    (issue) =>
                      issue.modeId === mode.key &&
                      issue.inputId === input.id &&
                      issue.severity === "error",
                  );
                  const label = `${input.label || "this Input"} in ${mode.name || "this Mode"}`;
                  const fixedDisplayValue =
                    input.kind === "select" &&
                    typeof setting.fixedValue === "string"
                      ? (input.options.find(
                          (option) => option.id === setting.fixedValue,
                        )?.label ?? setting.fixedValue)
                      : setting.fixedValue;
                  const stateLabel =
                    setting.state === "fixed"
                      ? `Fixed${fixedDisplayValue !== null && fixedDisplayValue !== "" ? ` (${fixedDisplayValue})` : ""}`
                      : setting.state.charAt(0).toUpperCase() +
                        setting.state.slice(1);
                  return (
                    <td
                      key={mode.key}
                      className={cn(
                        "border-b border-r border-border bg-card px-1.5 py-[5px] align-top",
                        !onPath && "opacity-40",
                        hasErr && "shadow-[inset_0_0_0_2px_var(--err)]",
                      )}
                    >
                      <CellPopover
                        input={input}
                        mode={mode}
                        setting={setting}
                        defaultOpen={
                          openCell?.modeKey === mode.key &&
                          openCell.inputId === input.id
                        }
                        ariaLabel={`${label}: ${stateLabel}`}
                        onChange={(patch) =>
                          onChange(modeIndex, input.id, patch)
                        }
                        onApplyToEveryEligibleMode={() =>
                          onApplyToEveryEligibleMode(modeIndex, input)
                        }
                      >
                        <StateChip
                          state={setting.state}
                          fixedValue={fixedDisplayValue}
                        />
                        {setting.label !== "" && (
                          <span className="block max-w-[110px] truncate text-[11px] text-muted-foreground">
                            {setting.label}
                          </span>
                        )}
                      </CellPopover>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[12.5px] text-muted-foreground">
        Coloured dots under a Mode's name are the Uploads its Path asks for. A
        red outline marks a cell with an error.
      </p>
    </div>
  );
}
