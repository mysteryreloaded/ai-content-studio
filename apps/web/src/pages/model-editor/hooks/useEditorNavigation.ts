import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { type SectionId, isSectionId } from "../frame/sections.js";

/**
 * The current section (`?section=`, kept with `replace`), the landing
 * rule (issue #213: an existing Model with Inputs opens on Modes, one
 * without opens on Inputs, a `?section=` in the URL wins — and neither
 * case puts anything into a "picking" state), and the no-op openers
 * later tickets (#215/#216) fill in. `focusBackend` is the one real
 * jump this ticket must do: it switches to Backends and scrolls that
 * Backend's row into view.
 */
export function useEditorNavigation({
  modelId,
  hasInputs,
}: {
  modelId: string | undefined;
  hasInputs: boolean | null;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const sectionParam = searchParams.get("section");
  const didLandRef = useRef<string | undefined>(undefined);

  const section: SectionId = isSectionId(sectionParam) ? sectionParam : "modes";

  function setSection(next: SectionId) {
    setSearchParams(
      (prev) => {
        const nextParams = new URLSearchParams(prev);
        nextParams.set("section", next);
        return nextParams;
      },
      { replace: true },
    );
  }

  // Lands once per Model: a `?section=` in the URL wins outright: it
  // is left as-is. Otherwise a Model with no Inputs yet lands on
  // Inputs, and one that already has some lands on Modes — without
  // setting anything to "picking" (issue #213 drops that old rule).
  // biome-ignore lint/correctness/useExhaustiveDependencies: lands once per modelId, deliberately not on every sectionParam/setSection change
  useEffect(() => {
    if (!modelId || hasInputs === null) return;
    if (didLandRef.current === modelId) return;
    didLandRef.current = modelId;
    if (isSectionId(sectionParam)) return;
    setSection(hasInputs ? "modes" : "inputs");
  }, [modelId, hasInputs]);

  // Issue #215: like `focusBackend`/`pendingFocusBackendId` below, this
  // remembers the Input to open so the Inputs section (once it's
  // mounted, which may be right after this `setSection`) can open that
  // Input's own sheet, from a check, a grid row head or an inspector
  // button.
  const [pendingOpenInputId, setPendingOpenInputId] = useState<string | null>(
    null,
  );

  function openInput(inputId: string) {
    setSection("inputs");
    setPendingOpenInputId(inputId);
  }

  function clearPendingOpenInput() {
    setPendingOpenInputId(null);
  }

  // Issue #216: mirrors `pendingOpenInputId` above — the Modes section
  // (once mounted) opens that Mode's sheet, or that cell's popover.
  const [pendingOpenModeId, setPendingOpenModeId] = useState<string | null>(
    null,
  );

  function openMode(modeId: string) {
    setSection("modes");
    setPendingOpenModeId(modeId);
  }

  function clearPendingOpenMode() {
    setPendingOpenModeId(null);
  }

  const [pendingOpenCell, setPendingOpenCell] = useState<{
    modeId: string;
    inputId: string;
  } | null>(null);

  function openCell(modeId: string, inputId: string) {
    setSection("modes");
    setPendingOpenCell({ modeId, inputId });
  }

  function clearPendingOpenCell() {
    setPendingOpenCell(null);
  }

  // The only jump this ticket makes real: open Backends, then — once
  // that section has actually mounted its row — scroll it into view.
  // A `requestAnimationFrame` right after `setSection` is too early
  // (the row doesn't exist until the section's own re-render commits),
  // so this remembers the target and an effect below picks it up once
  // `section` is "backends".
  const [pendingFocusBackendId, setPendingFocusBackendId] = useState<
    string | null
  >(null);

  function focusBackend(backendId: string) {
    setSection("backends");
    setPendingFocusBackendId(backendId);
  }

  useEffect(() => {
    if (section !== "backends" || !pendingFocusBackendId) return;
    const id = pendingFocusBackendId;
    setPendingFocusBackendId(null);
    const row = document.querySelector(`[data-backend-row="${id}"]`);
    row?.scrollIntoView({ block: "center" });
  }, [section, pendingFocusBackendId]);

  return {
    section,
    setSection,
    openInput,
    pendingOpenInputId,
    clearPendingOpenInput,
    openMode,
    pendingOpenModeId,
    clearPendingOpenMode,
    openCell,
    pendingOpenCell,
    clearPendingOpenCell,
    focusBackend,
  };
}

export type EditorNavigation = ReturnType<typeof useEditorNavigation>;
