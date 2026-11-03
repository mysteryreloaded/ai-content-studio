import type { ModelIssue } from "@ai-content-studio/shared";
import { inferOutputNodeKind } from "@ai-content-studio/shared";
import { ArrowUp, Plus, RotateCcw, X } from "lucide-react";
import { useState } from "react";
import { Button } from "../../../components/ui/button.js";
import { Input } from "../../../components/ui/input.js";
import { Pill } from "../../../components/ui/pill.js";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "../../../components/ui/sheet.js";
import { workflowForMode } from "../helpers/workflow.js";
import { UserFormPreview } from "../preview/UserFormPreview.js";
import type { DraftMode, ModelDetail } from "../types.js";
import { Field } from "../ui/Field.js";
import { TypeDot, typeDotKindForValueType } from "../ui/TypeDot.js";
import type { ModelEditor } from "../useModelEditor.js";
import { ModeSheetFacts } from "./ModeSheetFacts.js";
import { OutputPicker } from "./OutputPicker.js";

/** issue #216: the ordered Output nodes list, with kind pills, Move up/Remove, and the missing-node row. */
function OutputsEditor({
  mode,
  modeIndex,
  detail,
  editor,
}: {
  mode: DraftMode;
  modeIndex: number;
  detail: ModelDetail;
  editor: ModelEditor;
}) {
  const { updateMode, moveOutputNode, removeOutputNode } = editor;
  const [pickerOpen, setPickerOpen] = useState(false);
  const [replaceIndex, setReplaceIndex] = useState<number | null>(null);

  function pick(nodeId: string) {
    if (replaceIndex !== null) {
      const next = [...mode.outputNodeIds];
      next[replaceIndex] = nodeId;
      updateMode(modeIndex, { outputNodeIds: next });
    } else {
      updateMode(modeIndex, {
        outputNodeIds: [...mode.outputNodeIds, nodeId],
      });
    }
    setPickerOpen(false);
    setReplaceIndex(null);
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h4 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          Output nodes
        </h4>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            setReplaceIndex(null);
            setPickerOpen(true);
          }}
        >
          <Plus /> Output
        </Button>
      </div>

      {mode.outputNodeIds.length === 0 ? (
        <p
          role="alert"
          className="rounded-md bg-err-soft px-3 py-2 text-[13px]"
        >
          Name the node that saves this Mode's Asset. Its Path is that node plus
          everything it depends on.
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {mode.outputNodeIds.map((nodeId, position) => {
            const node = detail.workflow[nodeId];
            const missing = !node;
            const kind = node ? inferOutputNodeKind(node.class_type) : null;
            return (
              <li
                key={nodeId}
                className={
                  missing
                    ? "flex items-center gap-2 rounded-md bg-err-soft px-2.5 py-1.5 text-[13px]"
                    : "flex items-center gap-2 rounded-md border border-border bg-card px-2.5 py-1.5 text-[13px]"
                }
              >
                <Pill tone="neutral">
                  {position === 0 ? "Main Asset" : `Extra ${position}`}
                </Pill>
                {missing ? (
                  <>
                    <span className="flex-1">
                      #{nodeId} isn't in this Workflow.
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setReplaceIndex(position);
                        setPickerOpen(true);
                      }}
                    >
                      <RotateCcw /> Pick again
                    </Button>
                  </>
                ) : (
                  <>
                    <span className="flex-1 truncate font-mono font-semibold">
                      {node?._meta?.title ?? node?.class_type}
                    </span>
                    <span className="font-mono text-[11.5px] text-faint">
                      #{nodeId}
                    </span>
                    <Pill tone="accent" className="gap-1">
                      <TypeDot kind={typeDotKindForValueType("string")} />
                      {kind ?? "unknown kind"}
                    </Pill>
                  </>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Move up"
                  disabled={position === 0}
                  onClick={() => moveOutputNode(modeIndex, nodeId, "up")}
                >
                  <ArrowUp />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Remove output"
                  onClick={() => removeOutputNode(modeIndex, nodeId)}
                >
                  <X />
                </Button>
              </li>
            );
          })}
        </ul>
      )}

      <OutputPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        workflow={detail.workflow}
        alreadyUsed={new Set(mode.outputNodeIds)}
        onPick={pick}
      />
    </div>
  );
}

/**
 * The Mode sheet (issue #216): Name, Description, ordered Output
 * nodes, Path facts, this Mode's checks, and the "What users see"
 * preview — opened by clicking a Mode's name.
 */
export function ModeSheet({
  open,
  onOpenChange,
  mode,
  modeIndex,
  detail,
  editor,
  modelIssues,
  onJump,
  onDuplicated,
  onDeleted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: DraftMode | null;
  modeIndex: number;
  detail: ModelDetail;
  editor: ModelEditor;
  modelIssues: ModelIssue[];
  onJump: (issue: ModelIssue) => void;
  onDuplicated: (key: string) => void;
  onDeleted: () => void;
}) {
  const { updateMode, duplicateMode, removeMode, inputsDraft } = editor;
  const inputs = inputsDraft ?? detail.inputs ?? [];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 p-0 sm:max-w-[960px]">
        {mode && (
          <>
            <SheetHeader className="border-b border-border px-4 py-3">
              <SheetDescription className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                Mode
              </SheetDescription>
              <SheetTitle>{mode.name || "Untitled Mode"}</SheetTitle>
            </SheetHeader>
            <div className="grid grid-cols-[minmax(0,1fr)_340px] gap-4 overflow-y-auto p-4 @max-[760px]:grid-cols-1">
              <div className="flex min-w-0 flex-col gap-4">
                <Field label="Name" htmlFor={`mode-name-${mode.key}`}>
                  <Input
                    id={`mode-name-${mode.key}`}
                    value={mode.name}
                    maxLength={60}
                    onChange={(event) =>
                      updateMode(modeIndex, { name: event.target.value })
                    }
                  />
                </Field>
                <Field
                  label="Description"
                  htmlFor={`mode-description-${mode.key}`}
                >
                  <Input
                    id={`mode-description-${mode.key}`}
                    value={mode.description}
                    onChange={(event) =>
                      updateMode(modeIndex, {
                        description: event.target.value,
                      })
                    }
                  />
                </Field>

                <OutputsEditor
                  mode={mode}
                  modeIndex={modeIndex}
                  detail={detail}
                  editor={editor}
                />

                <ModeSheetFacts
                  mode={mode}
                  detail={detail}
                  modelIssues={modelIssues}
                  onJump={onJump}
                />

                <div className="flex gap-2 border-t border-border pt-3">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      const key = duplicateMode(modeIndex);
                      if (key) onDuplicated(key);
                    }}
                  >
                    Duplicate Mode
                  </Button>
                  <Button
                    type="button"
                    variant="danger"
                    onClick={() => {
                      removeMode(modeIndex);
                      onDeleted();
                    }}
                  >
                    Delete Mode
                  </Button>
                </div>
              </div>
              <div className="sticky top-4 self-start">
                <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                  What users see
                </h4>
                <UserFormPreview
                  modelName={detail.model.name}
                  attribution={detail.model.attribution}
                  mode={mode}
                  inputs={inputs}
                  workflow={workflowForMode(mode, inputs, detail.workflow)}
                  interactive={false}
                />
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
