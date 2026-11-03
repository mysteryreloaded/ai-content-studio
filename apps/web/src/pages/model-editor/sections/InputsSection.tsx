import { modeInputSetting } from "@ai-content-studio/shared";
import type { InputDefinition } from "@ai-content-studio/shared";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "../../../components/ui/button.js";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "../../../components/ui/sheet.js";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../../components/ui/table.js";
import type { EditorNavigation } from "../hooks/useEditorNavigation.js";
import { InputEditor } from "../inputs/InputEditor.js";
import { NewInputMenu } from "../inputs/NewInputMenu.js";
import { INPUT_TYPE_OPTIONS } from "../inputs/inputTypeOptions.js";
import type { ModelDetail } from "../types.js";
import { Section } from "../ui/Section.js";
import { TypeDot, typeDotKindFor } from "../ui/TypeDot.js";
import type { ModelEditor } from "../useModelEditor.js";

function typeLabelFor(kind: InputDefinition["kind"]): string {
  return INPUT_TYPE_OPTIONS.find((type) => type.kind === kind)?.label ?? kind;
}

export function InputsSection({
  editor,
  detail,
  nav,
}: {
  editor: ModelEditor;
  detail: ModelDetail;
  nav: EditorNavigation;
}) {
  const {
    createInput,
    inputsDraft,
    inputsHeadingRef,
    modelIssues,
    modesDraft,
    moveInput,
  } = editor;
  const [openInputId, setOpenInputId] = useState<string | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: consumes nav's one-shot "open this Input" signal, not every nav change
  useEffect(() => {
    if (!nav.pendingOpenInputId) return;
    setOpenInputId(nav.pendingOpenInputId);
    nav.clearPendingOpenInput();
  }, [nav.pendingOpenInputId]);

  const inputs = inputsDraft ?? [];
  const openIndex = inputs.findIndex((input) => input.id === openInputId);
  const openInput = openIndex >= 0 ? inputs[openIndex] : null;
  const hasSeed = inputs.some((input) => input.kind === "seed");

  return (
    <Section
      title="Inputs"
      sub="The fields users fill in. Each writes its value into one or more Node fields; blank keeps the Workflow's own value. They appear in this order."
      actions={
        <NewInputMenu
          hasSeed={hasSeed}
          onPick={(kind) => {
            const id = createInput(kind);
            if (id) setOpenInputId(id);
          }}
        />
      }
    >
      <h3 ref={inputsHeadingRef} className="sr-only">
        Inputs
      </h3>
      <Table>
        <TableHeader>
          <TableRow className="h-auto">
            <TableHead className="w-[54px] px-2.5 py-1.5 text-[13px]" />
            <TableHead className="px-2.5 py-1.5 text-[13px]">Input</TableHead>
            <TableHead className="px-2.5 py-1.5 text-[13px]">Type</TableHead>
            <TableHead className="px-2.5 py-1.5 text-[13px]">
              Writes into
            </TableHead>
            <TableHead className="px-2.5 py-1.5 text-[13px]">
              Shown in
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {inputs.length === 0 && (
            <TableRow className="h-auto">
              <TableCell
                colSpan={5}
                className="px-2.5 py-1.5 text-[13px] text-muted-foreground"
              >
                No Inputs yet. Add one, then bind it to a Node field.
              </TableCell>
            </TableRow>
          )}
          {inputs.map((input, index) => {
            const errorCount = modelIssues.filter(
              (issue) =>
                issue.inputId === input.id && issue.severity === "error",
            ).length;
            const states = (modesDraft ?? []).map(
              (mode) => modeInputSetting(mode.inputSettings, input.id).state,
            );
            const shown = states.filter(
              (state) => state === "optional" || state === "required",
            ).length;
            const fixed = states.filter((state) => state === "fixed").length;
            const [firstBinding, ...restBindings] = input.bindings;
            return (
              <TableRow
                key={input.id}
                className="h-auto cursor-pointer hover:bg-muted"
                onClick={() => setOpenInputId(input.id)}
              >
                <TableCell
                  className="w-[54px] px-2.5 py-1.5 text-[13px]"
                  onClick={(event) => event.stopPropagation()}
                >
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label="Move up"
                    disabled={index === 0}
                    onClick={() => moveInput(index, "up")}
                  >
                    <ChevronUp />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label="Move down"
                    disabled={index === inputs.length - 1}
                    onClick={() => moveInput(index, "down")}
                  >
                    <ChevronDown />
                  </Button>
                </TableCell>
                <TableCell className="px-2.5 py-1.5 text-[13px]">
                  <strong>{input.label || "Untitled Input"}</strong>
                  {errorCount > 0 && (
                    <span className="ml-1.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-err px-1.5 text-[11px] font-semibold text-card">
                      {errorCount}
                    </span>
                  )}
                </TableCell>
                <TableCell className="px-2.5 py-1.5 text-[13px]">
                  <span className="flex items-center gap-1.5">
                    <TypeDot kind={typeDotKindFor(input.kind)} />
                    {typeLabelFor(input.kind)}
                  </span>
                </TableCell>
                <TableCell className="px-2.5 py-1.5 text-[13px]">
                  {firstBinding ? (
                    <>
                      {firstBinding.title ?? firstBinding.nodeId}
                      <span className="font-mono">.{firstBinding.field}</span>
                      {restBindings.length > 0 && (
                        <span className="text-muted-foreground">
                          {" "}
                          +{restBindings.length}
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="text-err">Not bound</span>
                  )}
                </TableCell>
                <TableCell className="px-2.5 py-1.5 text-[13px] text-muted-foreground">
                  {shown} Mode{shown === 1 ? "" : "s"}
                  {fixed > 0 ? `, fixed in ${fixed}` : ""}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      <Sheet
        open={openInput !== null}
        onOpenChange={(open) => {
          if (!open) setOpenInputId(null);
        }}
      >
        <SheetContent className="w-full gap-0 p-0 sm:max-w-[560px]">
          {openInput && (
            <>
              <SheetHeader className="border-b border-border px-4 py-3">
                <SheetDescription className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                  Input
                </SheetDescription>
                <SheetTitle>{openInput.label || "Untitled Input"}</SheetTitle>
              </SheetHeader>
              <div className="flex-1 overflow-y-auto p-4">
                <InputEditor
                  input={openInput}
                  index={openIndex}
                  editor={editor}
                  detail={detail}
                  modelIssues={modelIssues}
                  onDeleted={() => setOpenInputId(null)}
                />
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </Section>
  );
}
