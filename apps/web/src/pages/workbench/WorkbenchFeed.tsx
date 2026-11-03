import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { SubmissionBlock } from "../../components/generations/SubmissionBlock.js";
import { Button } from "../../components/ui/button.js";
import { Pill } from "../../components/ui/pill.js";
import {
  underwayCountFor,
  useActiveGenerations,
} from "../../lib/generationsStream.js";
import { FirstSubmissionNotifyPrompt } from "../../notifications/FirstSubmissionNotifyPrompt.js";
import { GenerationDetailOverlay } from "../GenerationDetailOverlay.js";
import { UnderwayChip } from "./UnderwayChip.js";
import type { WorkbenchFeedProps } from "./types.js";

/** Re-renders every 30s so each block's relative time ("12 min ago") stays current. */
function useTick(intervalMs: number) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return tick;
}

export function WorkbenchFeed({
  model,
  submissions,
  hasMore,
  progressById,
  paused,
  lastOwnSubmissionId,
  cancellingSubmissionIds,
  deletingSubmissionIds,
  cancelErrorSubmissionId,
  deleteErrorSubmissionId,
  cancellingGenerationIds,
  deletingGenerationIds,
  handleCancelSubmission,
  handleDeleteSubmission,
  handleCancelGeneration,
  handleDeleteGeneration,
  handleDismissGeneration,
  setSubmissions,
}: WorkbenchFeedProps) {
  const tick = useTick(30_000);
  const { generations } = useActiveGenerations();
  const underway = underwayCountFor(generations, model.slug);
  const feedRef = useRef<HTMLElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `tick` only forces this to recompute every 30s; `new Date()` doesn't read it.
  const now = useMemo(() => new Date(), [tick]);
  const [openGenerationId, setOpenGenerationId] = useState<string | null>(null);

  const orderedIds = useMemo(
    () =>
      submissions.flatMap((submission) =>
        submission.generations.map((g) => g.id),
      ),
    [submissions],
  );

  // #199 later gives this its own URL over the Workbench; only this function changes then.
  function openDetails(id: string) {
    setOpenGenerationId(id);
  }

  function removeFromFeed(id: string) {
    setSubmissions((current) =>
      current
        .map((submission) => ({
          ...submission,
          generations: submission.generations.filter((g) => g.id !== id),
        }))
        .filter((submission) => submission.generations.length > 0),
    );
  }

  return (
    <>
      {openGenerationId && (
        <GenerationDetailOverlay
          id={openGenerationId}
          prevId={orderedIds[orderedIds.indexOf(openGenerationId) - 1] ?? null}
          nextId={orderedIds[orderedIds.indexOf(openGenerationId) + 1] ?? null}
          onClose={() => setOpenGenerationId(null)}
          onNavigate={setOpenGenerationId}
          onDeleted={removeFromFeed}
          onDismissed={removeFromFeed}
        />
      )}
      <section
        ref={feedRef}
        aria-label={`Your ${model.name} Generations`}
        className="flex min-w-0 flex-col gap-4 p-4.5 max-[860px]:px-4"
      >
        <div className="flex flex-wrap items-center gap-2.5">
          <h2 className="font-heading text-[18px]">
            Your {model.name} Generations
          </h2>
          {underway > 0 && <Pill tone="accent">{underway} under way</Pill>}
          <Link
            to={`/gallery?model=${model.id}`}
            className="ml-auto text-sm text-primary underline-offset-4 hover:underline"
          >
            Everything in Gallery
          </Link>
        </div>
        {submissions.length === 0 && (
          <div className="flex max-w-[60ch] flex-col gap-1.5 rounded-2xl border-[1.5px] border-dashed border-input p-[22px]">
            <p>
              <strong>Nothing yet.</strong>
            </p>
            <p className="text-muted-foreground">
              Pick a Mode, fill the form and press Generate. Each Generation
              shows up here right away and fills in while it runs; you can start
              more while others run.
            </p>
          </div>
        )}
        {submissions.map((submission) => (
          <SubmissionBlock
            key={submission.submissionId}
            submission={submission}
            progressById={progressById}
            paused={paused}
            now={now}
            cancellingSubmission={cancellingSubmissionIds.has(
              submission.submissionId,
            )}
            deletingSubmission={deletingSubmissionIds.has(
              submission.submissionId,
            )}
            cancelSubmissionError={
              cancelErrorSubmissionId === submission.submissionId
            }
            deleteSubmissionError={
              deleteErrorSubmissionId === submission.submissionId
            }
            cancellingGenerationIds={cancellingGenerationIds}
            deletingGenerationIds={deletingGenerationIds}
            offer={
              submission.submissionId === lastOwnSubmissionId ? (
                <FirstSubmissionNotifyPrompt />
              ) : undefined
            }
            onCancelSubmission={() =>
              handleCancelSubmission(submission.submissionId)
            }
            onDeleteSubmission={() =>
              handleDeleteSubmission(submission.submissionId)
            }
            onCancelGeneration={handleCancelGeneration}
            onDeleteGeneration={handleDeleteGeneration}
            onOpenDetails={openDetails}
            onDismissGeneration={handleDismissGeneration}
          />
        ))}
        {hasMore && (
          <Button asChild variant="outline">
            <Link to={`/gallery?model=${model.id}`}>
              Older {model.name} Generations in Gallery
            </Link>
          </Button>
        )}
      </section>
      <UnderwayChip count={underway} feedRef={feedRef} />
    </>
  );
}
