import {
  type CapsStatus,
  concurrentRemaining,
  dailyRemaining,
} from "@ai-content-studio/shared";
import { CountPicker } from "../../components/inputs/CountPicker.js";
import type { UploadState } from "../../components/inputs/types.js";
import { CapsLine } from "./CapsLine.js";
import { GenerateButton } from "./GenerateButton.js";
import { SubmitNotes } from "./SubmitNotes.js";
import type { SubmitState } from "./types.js";

/** The Workbench's pinned foot (issue #196, prototype `.va-go`): the count picker and Generate button, then the submit notes and errors, then the Caps line. Sticky at the bottom of the screen on phones. */
export function GenerateBar({
  capsStatus,
  hasSeedInput,
  count,
  setCount,
  submitState,
  cancelWaiting,
  uploads,
  paused,
  pauseNoticeText,
  handleGenerate,
  selectedModeId,
}: {
  capsStatus: CapsStatus | null;
  hasSeedInput: boolean;
  count: number;
  setCount: (count: number) => void;
  submitState: SubmitState;
  cancelWaiting: () => void;
  uploads: Record<string, UploadState>;
  paused: boolean;
  pauseNoticeText: string | null;
  handleGenerate: () => void;
  selectedModeId: string | null;
}) {
  const maxCount = capsStatus
    ? Math.min(4, dailyRemaining(capsStatus), concurrentRemaining(capsStatus))
    : 4;

  return (
    <footer className="flex flex-col gap-1.5 border-t border-border bg-card px-4.5 py-3 max-[860px]:sticky max-[860px]:bottom-0 max-[860px]:z-[5] max-[860px]:px-4 max-[860px]:pb-[max(12px,env(safe-area-inset-bottom))] max-[860px]:shadow-[0_-6px_16px_rgb(0_0_0/0.08)]">
      <div className="flex items-center gap-2">
        {hasSeedInput && (
          <CountPicker count={count} onChange={setCount} maxCount={maxCount} />
        )}
        <GenerateButton
          submitState={submitState}
          count={count}
          disabled={!selectedModeId || paused}
          onClick={handleGenerate}
        />
      </div>
      <SubmitNotes
        submitState={submitState}
        cancelWaiting={cancelWaiting}
        uploads={uploads}
        paused={paused}
        pauseNoticeText={pauseNoticeText}
      />
      {capsStatus && <CapsLine status={capsStatus} />}
    </footer>
  );
}
