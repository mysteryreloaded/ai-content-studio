import { useMutation } from "@tanstack/react-query";
import { cn } from "cn";
import { TriangleAlert } from "lucide-react";
import { api, ok } from "../../lib/api.js";
import { Button } from "../ui/button.js";
import type { GenerationSummary } from "./types.js";

/** Issue #68/#195: an Admin removed this Generation — a dismissable card, no reason, no reuse. */
export function RemovedCard({
  generation,
  onDismissed,
  square = false,
}: {
  generation: GenerationSummary;
  onDismissed: (id: string) => void;
  /** Issue #198: the Gallery's thumbnail grid keeps every card the same aspect ratio. */
  square?: boolean;
}) {
  const dismiss = useMutation({
    mutationFn: () =>
      ok(
        api.api.generations[":id"]["dismiss-removed"].$post({
          param: { id: generation.id },
        }),
      ),
    onSuccess: () => onDismissed(generation.id),
  });

  return (
    <div className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-card">
      <div
        className={cn(
          "relative w-full overflow-hidden bg-[repeating-linear-gradient(135deg,var(--sunk)_0_10px,var(--panel)_10px_20px)] text-muted-foreground",
          square ? "aspect-square" : "aspect-video",
        )}
      >
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 p-2.5 text-center">
          <TriangleAlert className="size-5" />
          <span>Removed by an administrator</span>
        </div>
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-1.5 px-2 py-1.5">
        <span className="min-w-0 flex-1" />
        <Button
          type="button"
          variant="ghost"
          size="xs"
          disabled={dismiss.isPending}
          onClick={() => dismiss.mutate()}
        >
          Dismiss
        </Button>
      </div>
    </div>
  );
}
