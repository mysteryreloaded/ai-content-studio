import { computeModePath, modeInputSetting } from "@ai-content-studio/shared";
import type {
  InputDefinition,
  ModeInputSetting,
  ModelIssue,
  Workflow,
} from "@ai-content-studio/shared";
import { cn } from "cn";
import {
  boundNodeIds,
  visibleBoundFieldsFor,
  workflowForMode,
} from "../helpers/workflow.js";
import type { DraftMode } from "../types.js";
import { IssueCount } from "../ui/ChecksList.js";
import { StateChip } from "../ui/StateChip.js";
import { TypeDot, typeDotKindFor } from "../ui/TypeDot.js";
import { CellPopover } from "./CellPopover.js";
import { fixedValueDisplay } from "./FixedValueEditor.js";

const UPLOAD_KINDS = new Set(["image_upload", "video_upload", "audio_upload"]);

const HEAD_CELL =
  "sticky top-0 z-[3] min-w-[112px] max-w-[132px] border-b border-r border-border bg-card px-1.5 py-[5px] align-bottom text-left font-semibold";
const BODY_CELL = "border-b border-r border-border bg-card px-1.5 py-[5px]";
const ROW_HEAD =
  "sticky left-0 z-[2] min-w-[190px] border-b border-r border-border bg-card px-1.5 py-[5px] text-left font-medium";
const CELL_BUTTON =
  "block w-full min-h-[22px] rounded-sm text-left hover:outline hover:outline-1 hover:outline-offset-1 hover:outline-primary focus-visible:outline-2";

/**
 * The Input × Mode grid (issue #216, variant A): a state chip per cell,
 * a popover the only way to edit one, an output row and per-Mode error
 * counts and Upload dots. Off-Path cells dim by class; error cells get
 * an inset outline.
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
  openCellKey,
  onOpenCellKeyChange,
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
  onOpenMode: (modeId: string) => void;
  onOpenInput: (inputId: string) => void;
  openCellKey: { modeId: string; inputId: string } | null;
  onOpenCellKeyChange: (
    key: { modeId: string; inputId: string } | null,
  ) => void;
}) {
  if (modes.length === 0) return null;

  const pathByMode = modes.map((mode) =>
    computeModePath(
      workflowForMode(mode, inputs, workflow),
      mode.outputNodeIds,
      visibleBoundFieldsFor(mode, inputs),
    ),
  );

  function errorsFor(modeId: string, inputId?: string): number {
    return modelIssues.filter(
      (issue) =>
        issue.severity === "error" &&
        issue.modeId === modeId &&
        (inputId === undefined || issue.inputId === inputId),
    ).length;
  }

  function hasCellError(modeId: string, inputId: string): boolean {
    return modelIssues.some(
      (issue) =>
        issue.severity === "error" &&
        issue.modeId === modeId &&
        issue.inputId === inputId,
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="max-h-[calc(100vh-230px)] overflow-auto rounded-xl border border-border bg-card">
        <table className="border-separate border-spacing-0 text-[12.5px]">
          <thead>
            <tr>
              <th className={cn(HEAD_CELL, "sticky left-0 z-[4]")}>
                <span className="text-[11px] font-normal text-muted-foreground">
                  Input ↓ · Mode →
                </span>
              </th>
              {modes.map((mode, modeIndex) => {
                const path = pathByMode[modeIndex];
                const uploadInputs = inputs.filter(
                  (input) =>
                    UPLOAD_KINDS.has(input.kind) &&
                    [...boundNodeIds(input)].some((id) =>
                      path?.nodeIds.has(id),
                    ),
                );
                const errorCount = errorsFor(mode.key);
                return (
                  <th key={mode.key} className={HEAD_CELL}>
                    <button
                      type="button"
                      className="text-left font-semibold hover:underline"
                      onClick={() => onOpenMode(mode.key)}
                    >
                      {mode.name || `Mode ${modeIndex + 1}`}
                    </button>
                    <div className="mt-1 flex items-center gap-1">
                      {uploadInputs.map((input, i) => (
                        <TypeDot
                          key={`${input.id}-${i}`}
                          kind={typeDotKindFor(input.kind)}
                        />
                      ))}
                      <IssueCount count={errorCount} tone="err" />
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row" className={cn(ROW_HEAD, "bg-muted")}>
                Output (main Asset)
              </th>
              {modes.map((mode, modeIndex) => {
                const mainId = mode.outputNodeIds[0];
                const extra = mode.outputNodeIds.length - 1;
                const missing = mainId !== undefined && !workflow[mainId];
                return (
                  <td key={mode.key} className={cn(BODY_CELL, "bg-muted")}>
                    {mainId === undefined ? (
                      <span className="text-err">none</span>
                    ) : (
                      <span className={missing ? "text-err" : undefined}>
                        <span className="font-mono">#{mainId}</span>
                        {missing && " missing"}
                        {!missing && extra > 0 && ` +${extra}`}
                      </span>
                    )}
                  </td>
                );
              })}
            </tr>

            {inputs.map((input) => (
              <tr key={input.id}>
                <th scope="row" className={ROW_HEAD}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-1.5 text-left hover:bg-muted"
                    onClick={() => onOpenInput(input.id)}
                  >
                    <TypeDot kind={typeDotKindFor(input.kind)} />
                    {input.label || "Untitled Input"}
                  </button>
                </th>
                {modes.map((mode, modeIndex) => {
                  const path = pathByMode[modeIndex];
                  const onPath =
                    mode.outputNodeIds.length > 0 &&
                    [...boundNodeIds(input)].some((id) =>
                      path?.nodeIds.has(id),
                    );
                  const setting = modeInputSetting(
                    mode.inputSettings,
                    input.id,
                  );
                  const cellErr = hasCellError(mode.key, input.id);
                  return (
                    <td
                      key={mode.key}
                      className={cn(
                        BODY_CELL,
                        !onPath && "opacity-40",
                        cellErr && "shadow-[inset_0_0_0_2px_var(--err)]",
                      )}
                    >
                      <CellPopover
                        input={input}
                        modeName={mode.name || `Mode ${modeIndex + 1}`}
                        setting={setting}
                        open={
                          openCellKey?.modeId === mode.key &&
                          openCellKey.inputId === input.id
                        }
                        onOpenChange={(nextOpen) =>
                          onOpenCellKeyChange(
                            nextOpen
                              ? { modeId: mode.key, inputId: input.id }
                              : null,
                          )
                        }
                        onChange={(patch) =>
                          onChange(modeIndex, input.id, patch)
                        }
                        onApplyToEveryEligibleMode={() =>
                          onApplyToEveryEligibleMode(modeIndex, input)
                        }
                      >
                        <button
                          type="button"
                          className={CELL_BUTTON}
                          aria-label={`${input.label || "Untitled Input"} in ${mode.name || `Mode ${modeIndex + 1}`}: ${setting.state}`}
                        >
                          <StateChip
                            state={setting.state}
                            fixedValue={fixedValueDisplay(
                              input,
                              setting.fixedValue,
                            )}
                          />
                          {setting.label && (
                            <div className="truncate text-[11px] text-muted-foreground">
                              {setting.label}
                            </div>
                          )}
                        </button>
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
