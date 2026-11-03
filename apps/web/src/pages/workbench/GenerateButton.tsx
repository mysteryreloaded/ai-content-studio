import { Loader2 } from "lucide-react";
import { Button } from "../../components/ui/button.js";
import type { SubmitState } from "./types.js";

function labelFor(submitState: SubmitState, count: number): string {
  if (submitState.status === "waiting") return "Waiting for Uploads…";
  if (submitState.status === "trimming") {
    return submitState.kind === "video"
      ? "Preparing video…"
      : "Preparing audio…";
  }
  if (submitState.status === "submitting") return "Sending…";
  return count > 1 ? `Generate ${count}` : "Generate";
}

/** The foot's own Generate button (issue #196, prototype `.btn.primary.go`): the accent colour, labelled by phase, busy (disabled, spinning) in every phase but idle. */
export function GenerateButton({
  submitState,
  count,
  disabled,
  onClick,
}: {
  submitState: SubmitState;
  count: number;
  disabled: boolean;
  onClick: () => void;
}) {
  const busy =
    submitState.status === "waiting" ||
    submitState.status === "trimming" ||
    submitState.status === "submitting";
  return (
    <Button
      type="button"
      className="ml-auto h-auto px-4.5 py-2 text-[15px] font-semibold"
      onClick={onClick}
      disabled={disabled || busy}
      aria-busy={busy}
    >
      {busy && <Loader2 className="size-3.5 animate-spin" />}
      {labelFor(submitState, count)}
    </Button>
  );
}
