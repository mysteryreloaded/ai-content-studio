import { cn } from "cn";
import { Maximize2, Square, TriangleAlert } from "lucide-react";
import { Button } from "../ui/button.js";
import { Pill } from "../ui/pill.js";
import { AssetPlayer } from "./AssetPlayer.js";
import { ConfirmDelete } from "./ConfirmDelete.js";
import { CopyButton } from "./CopyButton.js";
import { AiNote, DownloadAsset } from "./DownloadAsset.js";
import { GenerationProgress } from "./ProgressLabel.js";
import { RemovedCard } from "./RemovedCard.js";
import { genStatus, progressPercent } from "./stateLabel.js";
import {
  CANCELLABLE_STATES,
  DONE_STATES,
  type GenerationProgress as GenerationProgressData,
  type GenerationSummary,
} from "./types.js";

export function GenerationCard({
  generation,
  progress,
  paused,
  onCancel,
  onDelete,
  onOpenDetails,
  onDismissed,
  cancelPending,
  deletePending,
}: {
  generation: GenerationSummary;
  progress: GenerationProgressData | undefined;
  paused: boolean;
  onCancel: (id: string) => void;
  onDelete: (id: string) => void;
  onOpenDetails: (id: string) => void;
  onDismissed: (id: string) => void;
  cancelPending: boolean;
  deletePending: boolean;
}) {
  if (generation.removedAt) {
    return <RemovedCard generation={generation} onDismissed={onDismissed} />;
  }

  const status = genStatus(generation, { paused, progress });
  const mainAsset = generation.assets?.[0];
  const isActive = !DONE_STATES.has(generation.state);
  const isEnded = DONE_STATES.has(generation.state);
  const isPlaceholderClickable =
    generation.state === "failed" || generation.state === "cancelled";
  const pct = progressPercent(progress);

  return (
    <div className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-card">
      {generation.state === "succeeded" && mainAsset ? (
        <AssetPlayer asset={mainAsset} />
      ) : isPlaceholderClickable ? (
        <button
          type="button"
          className="relative h-[104px] w-full cursor-pointer appearance-none overflow-hidden border-0 bg-transparent p-0 text-left"
          onClick={() => onOpenDetails(generation.id)}
        >
          <div
            className={cn(
              "absolute inset-0 flex flex-col items-center justify-center bg-media text-media-foreground",
              generation.state === "failed" &&
                "bg-[color-mix(in_srgb,var(--err)_18%,var(--media))]",
              generation.state === "cancelled" &&
                "bg-[color-mix(in_srgb,var(--faint)_18%,var(--media))]",
              isActive &&
                "animate-shimmer bg-[length:250%_100%] bg-[linear-gradient(110deg,var(--media)_30%,color-mix(in_srgb,var(--accent)_22%,var(--media))_50%,var(--media)_70%)]",
            )}
          >
            <div className="flex flex-col items-center gap-1.5 p-2.5 text-center">
              {generation.state === "failed" && (
                <TriangleAlert className="size-5" />
              )}
              {generation.state === "cancelled" && (
                <Square className="size-5" />
              )}
              {isActive && generation.state === "running" && pct !== null ? (
                <span className="font-heading text-[26px] leading-none font-semibold">
                  {pct}%
                </span>
              ) : (
                isActive && (
                  <span className="text-xs leading-none font-medium uppercase tracking-[0.08em] opacity-85">
                    {status.stage}
                  </span>
                )
              )}
              {generation.state === "failed" && (
                <span className="max-w-[26ch] text-[13px]">
                  {generation.error}
                </span>
              )}
            </div>
          </div>
          {isActive && (
            <GenerationProgress generation={generation} progress={progress} />
          )}
        </button>
      ) : (
        <div
          className="relative w-full overflow-hidden"
          style={{ aspectRatio: "16 / 9" }}
        >
          <div
            className={cn(
              "absolute inset-0 flex flex-col items-center justify-center bg-media text-media-foreground",
              isActive &&
                "animate-shimmer bg-[length:250%_100%] bg-[linear-gradient(110deg,var(--media)_30%,color-mix(in_srgb,var(--accent)_22%,var(--media))_50%,var(--media)_70%)]",
            )}
          >
            <div className="flex flex-col items-center gap-1.5 p-2.5 text-center">
              {isActive && generation.state === "running" && pct !== null ? (
                <span className="font-heading text-[26px] leading-none font-semibold">
                  {pct}%
                </span>
              ) : (
                isActive && (
                  <span className="text-xs leading-none font-medium uppercase tracking-[0.08em] opacity-85">
                    {status.stage}
                  </span>
                )
              )}
            </div>
          </div>
          {isActive && (
            <GenerationProgress generation={generation} progress={progress} />
          )}
        </div>
      )}
      <div className="flex min-w-0 flex-wrap items-center gap-1.5 px-2 py-1.5">
        <Pill tone={status.tone}>{status.pill}</Pill>
        <span
          className="min-w-0 flex-1 truncate text-[12.5px] text-muted-foreground tabular-nums"
          title={status.text}
        >
          {status.text}
        </span>
        {CANCELLABLE_STATES.has(generation.state) && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={cancelPending}
            onClick={() => onCancel(generation.id)}
          >
            Cancel
          </Button>
        )}
        {generation.state === "succeeded" && mainAsset && (
          <DownloadAsset asset={mainAsset} />
        )}
        {isEnded && (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Details"
            title="Details"
            onClick={() => onOpenDetails(generation.id)}
          >
            <Maximize2 />
          </Button>
        )}
        {isEnded && (
          <ConfirmDelete
            label="Delete this Generation"
            onConfirm={() => onDelete(generation.id)}
            pending={deletePending}
          />
        )}
      </div>
      {generation.state === "succeeded" && mainAsset && <AiNote />}
      {generation.state === "failed" && (
        <div className="flex items-center gap-1 px-2 pb-1.5 font-mono text-[12.5px] text-faint break-all">
          <span>{generation.id}</span>
          <CopyButton text={generation.id} label="Copy Generation id" />
        </div>
      )}
    </div>
  );
}
