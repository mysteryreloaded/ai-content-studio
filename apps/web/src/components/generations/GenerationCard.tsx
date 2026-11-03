import { cn } from "cn";
import {
  AudioLines,
  Maximize2,
  Play,
  Square,
  TriangleAlert,
} from "lucide-react";
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
  type AssetSummary,
  CANCELLABLE_STATES,
  DONE_STATES,
  type GenerationProgress as GenerationProgressData,
  type GenerationSummary,
} from "./types.js";

/** The Gallery's `media="thumbnail"` thumbnail src: the small `/thumb` for an image, the `/poster` frame for a video, or null for audio (issue #198). */
function thumbSrcFor(asset: AssetSummary): string | null {
  if (asset.kind === "image") return `/api/assets/${asset.id}/thumb`;
  if (asset.kind === "video") return `/api/assets/${asset.id}/poster`;
  return null;
}

export function GenerationCard({
  generation,
  progress,
  paused,
  media = "player",
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
  /** Issue #198: the Gallery's list shows a thumbnail with a play mark (no players in the list) instead of the Workbench's in-place player. */
  media?: "player" | "thumbnail";
  onCancel: (id: string) => void;
  onDelete: (id: string) => void;
  onOpenDetails: (id: string) => void;
  onDismissed: (id: string) => void;
  cancelPending: boolean;
  deletePending: boolean;
}) {
  if (generation.removedAt) {
    return (
      <RemovedCard
        generation={generation}
        onDismissed={onDismissed}
        square={media === "thumbnail"}
      />
    );
  }

  const status = genStatus(generation, { paused, progress });
  const mainAsset = generation.assets?.[0];
  const extraAssets = (generation.assets?.length ?? 0) - 1;
  const isActive = !DONE_STATES.has(generation.state);
  const isEnded = DONE_STATES.has(generation.state);
  const isPlaceholderClickable =
    generation.state === "failed" || generation.state === "cancelled";
  const pct = progressPercent(progress);

  if (media === "thumbnail") {
    const thumb = mainAsset ? thumbSrcFor(mainAsset) : null;
    return (
      <div className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-card">
        <button
          type="button"
          className="relative block aspect-square w-full cursor-pointer appearance-none overflow-hidden border-0 bg-transparent p-0 text-left"
          onClick={() => onOpenDetails(generation.id)}
          aria-label={`Open Generation ${generation.id}`}
        >
          {generation.state === "succeeded" && mainAsset ? (
            thumb ? (
              <>
                <img src={thumb} alt="" className="size-full object-cover" />
                {mainAsset.kind === "video" && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="flex size-9 items-center justify-center rounded-full bg-black/55 text-white">
                      <Play className="size-4 fill-current" />
                    </span>
                  </div>
                )}
              </>
            ) : (
              <div className="absolute inset-0 flex items-center justify-center bg-media text-media-foreground">
                <AudioLines className="size-6" />
              </div>
            )
          ) : (
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
                  <span className="line-clamp-4 text-[13px]">
                    {generation.error}
                  </span>
                )}
              </div>
            </div>
          )}
          {extraAssets > 0 && (
            <span className="absolute top-1 right-1 rounded-full bg-black/70 px-1.5 text-xs text-white">
              +{extraAssets}
            </span>
          )}
          {generation.isTest && (
            <Pill tone="neutral" className="absolute top-1 left-1">
              Test
            </Pill>
          )}
          {isActive && (
            <GenerationProgress generation={generation} progress={progress} />
          )}
        </button>
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
