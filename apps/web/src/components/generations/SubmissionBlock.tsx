import { cn } from "cn";
import type { ReactNode } from "react";
import { Button } from "../ui/button.js";
import { ConfirmDelete } from "./ConfirmDelete.js";
import { GenerationCard } from "./GenerationCard.js";
import { ago } from "./stateLabel.js";
import {
  DONE_STATES,
  type GenerationProgress,
  type SubmissionSummary,
  type SubmissionUploadSummary,
} from "./types.js";

function UsedUploads({ uploads }: { uploads: SubmissionUploadSummary[] }) {
  const visible = uploads.filter(
    (upload) => !upload.removed && upload.thumbnailKey,
  );
  if (visible.length === 0) return null;
  return (
    <span className="inline-flex gap-[3px]">
      {visible.map((upload) => (
        <img
          key={upload.id}
          src={`/api/uploads/${upload.id}/thumb`}
          alt=""
          className="size-[22px] rounded-[3px] object-cover"
        />
      ))}
    </span>
  );
}

function PromptLine({ prompt }: { prompt: string | null | undefined }) {
  if (prompt === undefined) return null;
  if (prompt === null) {
    return <p className="max-w-[80ch] text-[13px] text-faint">No prompt</p>;
  }
  const isDefault = prompt.startsWith("Default prompt: ");
  return (
    <p
      className={cn(
        "max-w-[80ch] truncate text-[13px]",
        isDefault ? "text-faint" : "text-muted-foreground",
      )}
      title={prompt}
    >
      {prompt}
    </p>
  );
}

export function SubmissionBlock({
  submission,
  progressById,
  paused,
  now,
  cancellingSubmission,
  deletingSubmission,
  cancelSubmissionError,
  deleteSubmissionError,
  cancellingGenerationIds,
  deletingGenerationIds,
  offer,
  onCancelSubmission,
  onDeleteSubmission,
  onCancelGeneration,
  onDeleteGeneration,
  onOpenDetails,
  onDismissGeneration,
}: {
  submission: SubmissionSummary;
  progressById: Map<string, GenerationProgress>;
  paused: boolean;
  now: Date;
  cancellingSubmission: boolean;
  deletingSubmission: boolean;
  cancelSubmissionError: boolean;
  deleteSubmissionError: boolean;
  cancellingGenerationIds: Set<string>;
  deletingGenerationIds: Set<string>;
  offer?: ReactNode;
  onCancelSubmission: () => void;
  onDeleteSubmission: () => void;
  onCancelGeneration: (id: string) => void;
  onDeleteGeneration: (id: string) => void;
  onOpenDetails: (id: string) => void;
  onDismissGeneration: (id: string) => void;
}) {
  const { generations } = submission;
  const activeCount = generations.filter(
    (g) => !DONE_STATES.has(g.state) && g.state !== "cancelling",
  ).length;
  const allEnded = generations.every((g) => DONE_STATES.has(g.state));

  return (
    <div className="flex min-w-0 flex-col gap-1.5 border-b border-border pb-3.5 last:border-b-0">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <strong>{submission.modeName}</strong>
        {submission.uploads && <UsedUploads uploads={submission.uploads} />}
        <span className="text-[12.5px] text-faint">
          {ago(submission.submittedAt, now)}
          {generations.length > 1 ? ` · ${generations.length} Generations` : ""}
        </span>
        <span className="min-w-0 flex-1" />
        {activeCount >= 2 && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={cancellingSubmission}
            onClick={onCancelSubmission}
          >
            Cancel all
          </Button>
        )}
        {allEnded && generations.length > 1 && (
          <ConfirmDelete
            small={false}
            label="Delete all"
            onConfirm={onDeleteSubmission}
            pending={deletingSubmission}
          />
        )}
      </div>
      {cancelSubmissionError && (
        <p role="alert">Could not cancel. Please try again.</p>
      )}
      {deleteSubmissionError && (
        <p role="alert">Could not delete. Please try again.</p>
      )}
      <PromptLine prompt={submission.prompt} />
      {offer}
      <div
        className={cn(
          "grid items-start gap-2.5 grid-cols-[repeat(auto-fit,minmax(min(100%,240px),1fr))] max-[560px]:grid-cols-1",
          generations.length === 1 && "grid-cols-[minmax(0,520px)]",
          generations.length === 2 && "max-w-[980px]",
        )}
      >
        {generations.map((generation) => (
          <GenerationCard
            key={generation.id}
            generation={generation}
            progress={progressById.get(generation.id)}
            paused={paused}
            cancelPending={cancellingGenerationIds.has(generation.id)}
            deletePending={deletingGenerationIds.has(generation.id)}
            onCancel={onCancelGeneration}
            onDelete={onDeleteGeneration}
            onOpenDetails={onOpenDetails}
            onDismissed={onDismissGeneration}
          />
        ))}
      </div>
    </div>
  );
}
