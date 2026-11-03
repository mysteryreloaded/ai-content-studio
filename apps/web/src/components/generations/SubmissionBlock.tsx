import { DONE_STATES } from "./types.js";
import type { GenerationProgress, SubmissionSummary } from "./types.js";
import { GenerationCard } from "./GenerationCard.js";

export function SubmissionBlock({
  submission,
  progressById,
  paused,
  cancelling,
  deleting,
  cancelError,
  deleteError,
  onOpen,
  onCancel,
  onDelete,
}: {
  submission: SubmissionSummary;
  progressById: Map<string, GenerationProgress>;
  paused: boolean;
  cancelling: boolean;
  deleting: boolean;
  cancelError: boolean;
  deleteError: boolean;
  onOpen: () => void;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const hasUnfinished = submission.generations.some(
    (g) => !DONE_STATES.has(g.state),
  );
  return (
    <li>
      <button type="button" onClick={onOpen}>
        <strong>{submission.modeName}</strong>{" "}
        <time dateTime={submission.submittedAt}>
          {new Date(submission.submittedAt).toLocaleString()}
        </time>
        {submission.prompt && (
          <span style={{ display: "block" }}>{submission.prompt}</span>
        )}
      </button>
      {hasUnfinished ? (
        <button type="button" disabled={cancelling} onClick={onCancel}>
          Cancel
        </button>
      ) : (
        <button type="button" disabled={deleting} onClick={onDelete}>
          Delete all
        </button>
      )}
      {cancelError && <p role="alert">Could not cancel. Please try again.</p>}
      {deleteError && <p role="alert">Could not delete. Please try again.</p>}
      <ul>
        {submission.generations.map((generation) => (
          <GenerationCard
            key={generation.id}
            generation={generation}
            progress={progressById.get(generation.id)}
            paused={paused}
          />
        ))}
      </ul>
    </li>
  );
}
