import { capsFooterText } from "@ai-content-studio/shared";
import type { CapsStatus } from "@ai-content-studio/shared";
import type { SubmitState } from "./types.js";

export function GenerateBar({
  capsStatus,
  activeCount,
  submitState,
  cancelWaiting,
  paused,
  pauseNoticeText,
  handleGenerate,
  selectedModeId,
}: {
  capsStatus: CapsStatus | null;
  activeCount: number;
  submitState: SubmitState;
  cancelWaiting: () => void;
  paused: boolean;
  pauseNoticeText: string | null;
  handleGenerate: () => void;
  selectedModeId: string | null;
}) {
  return (
    <footer className="workbench-generate-bar">
      {capsStatus && (
        <span className="workbench-caps">
          {capsFooterText(capsStatus, new Date())}
        </span>
      )}
      {activeCount > 0 && (
        <span className="workbench-chip">{activeCount} under way</span>
      )}
      {submitState.status === "waiting" ? (
        <>
          <output>Waiting for your files to finish…</output>
          <button type="button" onClick={cancelWaiting}>
            Don't start
          </button>
        </>
      ) : submitState.status === "trimming" ? (
        <output>Trimming your video or audio…</output>
      ) : (
        <>
          {paused && pauseNoticeText && (
            // biome-ignore lint/a11y/useSemanticElements: <output> is for a form's calculated result, not this status message
            <p role="status">{pauseNoticeText}</p>
          )}
          <button
            type="button"
            onClick={handleGenerate}
            disabled={
              !selectedModeId || submitState.status === "submitting" || paused
            }
          >
            Generate
          </button>
        </>
      )}
    </footer>
  );
}
