import type { ModelIssue } from "@ai-content-studio/shared";
import { useEffect, useState } from "react";
import { Button } from "../../../components/ui/button.js";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "../../../components/ui/sheet.js";
import type { EditorNavigation } from "../hooks/useEditorNavigation.js";
import { ModeInputGrid } from "../modes/ModeInputGrid.js";
import { ModeSheetContent } from "../modes/ModeSheetContent.js";
import type { ModelDetail } from "../types.js";
import { Section } from "../ui/Section.js";
import type { ModelEditor } from "../useModelEditor.js";

export function ModesSection({
  editor,
  detail,
  nav,
}: {
  editor: ModelEditor;
  detail: ModelDetail;
  nav: EditorNavigation;
}) {
  const {
    addMode,
    applySettingToEveryEligibleMode,
    inputsDraft,
    modesDraft,
    modesHeadingRef,
    modelIssues,
    setModeInputSetting,
  } = editor;

  const [openModeKey, setOpenModeKey] = useState<string | null>(null);
  const [openCellKey, setOpenCellKey] = useState<{
    modeId: string;
    inputId: string;
  } | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: consumes nav's one-shot "open this Mode" signal, not every nav change
  useEffect(() => {
    if (!nav.pendingOpenModeId) return;
    setOpenModeKey(nav.pendingOpenModeId);
    nav.clearPendingOpenMode();
  }, [nav.pendingOpenModeId]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: consumes nav's one-shot "open this cell" signal, not every nav change
  useEffect(() => {
    if (!nav.pendingOpenCellKey) return;
    setOpenCellKey(nav.pendingOpenCellKey);
    nav.clearPendingOpenCell();
  }, [nav.pendingOpenCellKey]);

  const modes = modesDraft ?? [];
  const inputs = inputsDraft ?? detail.inputs ?? [];
  const openIndex = modes.findIndex((mode) => mode.key === openModeKey);
  const openMode = openIndex >= 0 ? modes[openIndex] : null;

  function jumpWithinSheet(issue: ModelIssue) {
    if (issue.backendId) {
      nav.focusBackend(issue.backendId);
      return;
    }
    if (issue.inputId && issue.modeId) {
      setOpenModeKey(null);
      setOpenCellKey({ modeId: issue.modeId, inputId: issue.inputId });
      return;
    }
    if (issue.inputId) {
      nav.openInput(issue.inputId);
    }
  }

  return (
    <Section
      title="Modes"
      sub="Each Mode is a preset users pick. Its output nodes set its Path; each cell sets whether an Input is hidden, optional, required or fixed in that Mode. Click a cell to change it, or a Mode's name to edit it."
      actions={
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            const key = addMode();
            if (key) setOpenModeKey(key);
          }}
        >
          + Mode
        </Button>
      }
    >
      <h3 ref={modesHeadingRef} className="sr-only">
        Modes
      </h3>

      {modes.length === 0 ? (
        <p className="text-muted-foreground">
          No Modes yet. A Model needs at least one; name its output node to
          define its Path.
        </p>
      ) : (
        <ModeInputGrid
          modes={modes}
          inputs={inputs}
          workflow={detail.workflow}
          modelIssues={modelIssues}
          onChange={setModeInputSetting}
          onApplyToEveryEligibleMode={applySettingToEveryEligibleMode}
          onOpenMode={setOpenModeKey}
          onOpenInput={nav.openInput}
          openCellKey={openCellKey}
          onOpenCellKeyChange={setOpenCellKey}
        />
      )}

      <Sheet
        open={openMode !== null}
        onOpenChange={(open) => {
          if (!open) setOpenModeKey(null);
        }}
      >
        <SheetContent className="w-full gap-0 p-0 data-[side=right]:w-full sm:max-w-[960px] data-[side=right]:sm:max-w-[960px]">
          {openMode && (
            <>
              <SheetHeader className="border-b border-border px-4 py-3">
                <SheetDescription className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                  Mode
                </SheetDescription>
                <SheetTitle>{openMode.name || "Untitled Mode"}</SheetTitle>
              </SheetHeader>
              <div className="flex-1 overflow-y-auto p-4">
                <ModeSheetContent
                  mode={openMode}
                  modeIndex={openIndex}
                  detail={detail}
                  editor={editor}
                  modelIssues={modelIssues}
                  onJumpToIssue={jumpWithinSheet}
                  onClose={() => setOpenModeKey(null)}
                  onDuplicated={(newKey) => setOpenModeKey(newKey)}
                />
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </Section>
  );
}
