import type { GenerationSummary, SubmissionSummary } from "./types.js";

/** Replaces or adds `generation` within its own Submission, creating that Submission if this is its first known Generation. */
export function upsertGeneration(
  current: SubmissionSummary[],
  generation: GenerationSummary,
): SubmissionSummary[] {
  const index = current.findIndex(
    (s) => s.submissionId === generation.submissionId,
  );
  if (index === -1) {
    const submission: SubmissionSummary = {
      submissionId: generation.submissionId,
      modeId: generation.modeId,
      modeName: generation.modeName,
      submittedAt: generation.submittedAt,
      generations: [generation],
    };
    return [submission, ...current].slice(0, 8);
  }

  const submission = current[index] as SubmissionSummary;
  const genIndex = submission.generations.findIndex(
    (g) => g.id === generation.id,
  );
  const generations =
    genIndex === -1
      ? [...submission.generations, generation]
      : submission.generations.map((g, i) =>
          i === genIndex
            ? mergeGeneration(
                submission.generations[i] as GenerationSummary,
                generation,
              )
            : g,
        );
  const updated = [...current];
  updated[index] = { ...submission, generations };
  return updated;
}

/** Keeps `removedAt` once set when an SSE "change" event replaces a Generation (issue #68's AC; mirrors GalleryPage.tsx's own fix): the runner's own events always carry `removedAt: null`. */
export function mergeGeneration(
  previous: GenerationSummary,
  incoming: GenerationSummary,
): GenerationSummary {
  return previous.removedAt
    ? { ...incoming, removedAt: previous.removedAt }
    : incoming;
}
