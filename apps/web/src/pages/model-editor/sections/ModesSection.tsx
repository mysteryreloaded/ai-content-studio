import type { ModelIssue } from "@ai-content-studio/shared";
import { useEffect, useState } from "react";
import { Button } from "../../../components/ui/button.js";
import type { EditorNavigation } from "../hooks/useEditorNavigation.js";
import { ModeInputGrid } from "../modes/ModeInputGrid.js";
import { ModeSheet } from "../modes/ModeSheet.js";
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
    modesDraft,
    modesHeadingRef,
    modelIssues,
    setModeInputSetting,
  } = editor;
  const [openModeKey, setOpenModeKey] = useState<string | null>(null);
  const [openCellTarget, setOpenCellTarget] = useState<{
    modeKey: string;
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
    if (!nav.pendingOpenCell) return;
    setOpenCellTarget({
      modeKey: nav.pendingOpenCell.modeId,
      inputId: nav.pendingOpenCell.inputId,
    });
    nav.clearPendingOpenCell();
  }, [nav.pendingOpenCell]);

  const modes = modesDraft ?? [];
  const openIndex = modes.findIndex((mode) => mode.key === openModeKey);
  const openMode = openIndex >= 0 ? (modes[openIndex] ?? null) : null;

  function jump(issue: ModelIssue) {
    if (issue.inputId && issue.modeId) {
      setOpenCellTarget({ modeKey: issue.modeId, inputId: issue.inputId });
      return;
    }
    if (issue.modeId) setOpenModeKey(issue.modeId);
  }

  return (
    <Section
      title="Modes"
      sub="Each Mode is a preset users pick. Its output nodes set its Path; each cell sets whether an Input is hidden, optional, required or fixed in that Mode. Click a cell to change it, or a Mode's name to edit it."
      actions={
        <Button
          type="button"
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
        <p className="text-[13px] text-muted-foreground">
          No Modes yet. A Model needs at least one; name its output node to
          define its Path.
        </p>
      ) : (
        <ModeInputGrid
          modes={modes}
          inputs={detail.inputs ?? []}
          workflow={detail.workflow}
          modelIssues={modelIssues}
          onChange={setModeInputSetting}
          onApplyToEveryEligibleMode={applySettingToEveryEligibleMode}
          onOpenMode={(mode) => setOpenModeKey(mode.key)}
          onOpenInput={(inputId) => nav.openInput(inputId)}
          openCell={openCellTarget}
        />
      )}

      <ModeSheet
        open={openMode !== null}
        onOpenChange={(open) => {
          if (!open) setOpenModeKey(null);
        }}
        mode={openMode}
        modeIndex={openIndex}
        detail={detail}
        editor={editor}
        modelIssues={modelIssues}
        onJump={jump}
        onDuplicated={(key) => setOpenModeKey(key)}
        onDeleted={() => setOpenModeKey(null)}
      />
    </Section>
  );
}
