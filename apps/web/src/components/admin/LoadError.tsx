import { Button } from "../ui/button.js";

/** The prototype's `.callout.err` (issue #200): a failed load, with a retry button. */
export function LoadError({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center justify-between gap-2 rounded-r-md border border-l-[3px] border-border border-l-err bg-card px-3 py-[9px]"
    >
      <span>{message}</span>
      <Button type="button" variant="outline" size="sm" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}
