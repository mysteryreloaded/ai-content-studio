import { TriangleAlert } from "lucide-react";
import type { UploadState } from "../../components/inputs/types.js";
import { Button } from "../../components/ui/button.js";
import type { SubmitState } from "./types.js";

/** The foot's notes and submit error (issue #196, prototype `SubmitNotes`), between the Generate row and the Caps line: the trimming note, the waiting note with "Don't start", the pending-Uploads note, the Pause message, then the submit error. */
export function SubmitNotes({
  submitState,
  cancelWaiting,
  uploads,
  paused,
  pauseNoticeText,
}: {
  submitState: SubmitState;
  cancelWaiting: () => void;
  uploads: Record<string, UploadState>;
  paused: boolean;
  pauseNoticeText: string | null;
}) {
  const runningUploads = Object.values(uploads).filter(
    (upload) => upload.status === "uploading",
  ).length;

  return (
    <>
      {submitState.status === "trimming" && (
        <p className="text-[12.5px] text-muted-foreground">
          {submitState.kind === "video"
            ? "Trimming your video on the server. This can take up to a minute and a half."
            : "Trimming your audio on the server."}
        </p>
      )}
      {submitState.status === "waiting" && (
        <p className="text-[12.5px] text-muted-foreground">
          Your Generation starts as soon as{" "}
          {runningUploads > 1
            ? `${runningUploads} Uploads finish.`
            : "your Upload finishes."}{" "}
          <Button
            type="button"
            variant="link"
            className="h-auto p-0"
            onClick={cancelWaiting}
          >
            Don't start
          </Button>
        </p>
      )}
      {submitState.status === "idle" && runningUploads > 0 && (
        <p className="text-[12.5px] text-muted-foreground">
          {runningUploads} Upload{runningUploads > 1 ? "s" : ""} still in
          progress. You can keep filling the form, or press Generate now.
        </p>
      )}
      {paused && pauseNoticeText && (
        // biome-ignore lint/a11y/useSemanticElements: <output> is for a form's calculated result, not this status message
        <p role="status" className="text-[12.5px] text-muted-foreground">
          {pauseNoticeText}
        </p>
      )}
      {submitState.status === "error" && (
        <p
          role="alert"
          className="flex items-start gap-[5px] text-[12.5px] text-err"
        >
          <TriangleAlert className="size-3.5 shrink-0 translate-y-px" />
          {submitState.message}
        </p>
      )}
    </>
  );
}
