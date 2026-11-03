// The Gallery's pure helpers (issue #198): filters, day grouping, the
// SSE insert order and the server's raw shape, kept free of React/Query
// so they stay simple to test. `GalleryPage.tsx` re-exports `dayLabel`,
// which `GalleryPage.test.tsx` imports from there.

import { mergeGeneration } from "../../components/generations/submissionCache.js";
import type {
  GenerationState,
  GenerationSummary,
  SubmissionSummary,
  SubmissionUploadSummary,
} from "../../components/generations/types.js";

export { mergeGeneration };

export type StateFilter = "all" | "underway" | "finished" | "failed";

export const STATE_BUCKETS: Record<
  Exclude<StateFilter, "all">,
  GenerationState[]
> = {
  underway: ["queued", "starting", "running", "saving", "cancelling"],
  finished: ["succeeded"],
  // "Failed or cancelled" (issue #54): a cancelled Generation never
  // produced anything to show either, so it buckets with "failed".
  failed: ["failed", "cancelled"],
};

export const STATE_LABELS: Record<StateFilter, string> = {
  all: "All",
  underway: "Under way",
  finished: "Finished",
  failed: "Failed or cancelled",
};

/** An unrecognised `?state=` (a stale link, a typo) reads as "all" rather than throwing later when a bucket lookup misses. */
export function toStateFilter(value: string | null): StateFilter {
  return value !== null && value in STATE_LABELS
    ? (value as StateFilter)
    : "all";
}

export function matchesStateFilter(
  state: GenerationState,
  filter: StateFilter,
): boolean {
  return filter === "all" || STATE_BUCKETS[filter].includes(state);
}

export const PAGE_LIMIT = 24;

export interface GalleryModelOption {
  id: string;
  slug: string;
  name: string;
  deleted: boolean;
}

/** `/api/gallery`'s raw shape (server's `GallerySubmission`): the Model and Mode sit on the Submission, not per-Generation. */
export interface RawGallerySubmission {
  submissionId: string;
  modelId: string;
  modelSlug: string;
  modelName: string;
  modeId: string;
  modeName: string;
  submittedAt: string;
  prompt: string | null;
  uploads: SubmissionUploadSummary[];
  generations: Array<Omit<GenerationSummary, "modelSlug" | "modelName">>;
}

export interface RawGalleryPage {
  submissions: RawGallerySubmission[];
  hasMore: boolean;
}

/** Copies the Submission's Model onto each of its Generations, the shape the shared `SubmissionBlock`/`GenerationCard` expect. */
export function toSubmissionSummary(
  raw: RawGallerySubmission,
): SubmissionSummary {
  return {
    submissionId: raw.submissionId,
    modeId: raw.modeId,
    modeName: raw.modeName,
    submittedAt: raw.submittedAt,
    prompt: raw.prompt,
    uploads: raw.uploads,
    generations: raw.generations.map((generation) => ({
      ...generation,
      modelSlug: raw.modelSlug,
      modelName: raw.modelName,
    })),
  };
}

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** The day header label, in the browser's own time zone (issue #56): Today, Yesterday, or "Wednesday 21 October", the year appended when it isn't the current one. */
export function dayLabel(date: Date, now: Date): string {
  const atMidnight = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round(
    (atMidnight(now) - atMidnight(date)) / (24 * 60 * 60 * 1000),
  );
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";

  const label = `${WEEKDAYS[date.getDay()]} ${date.getDate()} ${MONTHS[date.getMonth()]}`;
  return date.getFullYear() === now.getFullYear()
    ? label
    : `${label} ${date.getFullYear()}`;
}

export interface DayGroup {
  label: string;
  submissions: SubmissionSummary[];
}

/** Groups `submissions` (already newest first) into consecutive same-day runs, each with its own day header. */
export function groupByDay(
  submissions: SubmissionSummary[],
  now: Date,
): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const submission of submissions) {
    const label = dayLabel(new Date(submission.submittedAt), now);
    const last = groups[groups.length - 1];
    if (last && last.label === label) {
      last.submissions.push(submission);
    } else {
      groups.push({ label, submissions: [submission] });
    }
  }
  return groups;
}

/** Whether `a` sorts no later than `b` in the Gallery's own (submittedAt desc, submissionId desc) order — i.e. `a` is newer, or equally new with a "greater" id. */
export function sortsNoLaterThan(
  a: { submittedAt: string; submissionId: string },
  b: { submittedAt: string; submissionId: string },
): boolean {
  if (a.submittedAt !== b.submittedAt) return a.submittedAt > b.submittedAt;
  return a.submissionId >= b.submissionId;
}

/**
 * Inserts a newly-seen Submission at its (submittedAt, id) position
 * rather than always on top (QA round 1): an SSE event can arrive for an
 * older Submission (one that just failed, or just moved into a state
 * filter's bucket). When `hasMore` is true and it sorts at or after the
 * last loaded page's end, its real position is in a page this tab
 * hasn't fetched yet, so it's dropped instead of risking a wrong
 * position or a duplicate once "Load more" reaches it.
 */
export function insertSubmission(
  current: SubmissionSummary[],
  submission: SubmissionSummary,
  hasMore: boolean,
): SubmissionSummary[] {
  const last = current[current.length - 1];
  if (
    hasMore &&
    last &&
    sortsNoLaterThan(
      { submittedAt: last.submittedAt, submissionId: last.submissionId },
      {
        submittedAt: submission.submittedAt,
        submissionId: submission.submissionId,
      },
    )
  ) {
    return current;
  }

  const index = current.findIndex(
    (existing) =>
      !sortsNoLaterThan(
        {
          submittedAt: existing.submittedAt,
          submissionId: existing.submissionId,
        },
        {
          submittedAt: submission.submittedAt,
          submissionId: submission.submissionId,
        },
      ),
  );
  if (index === -1) return [...current, submission];
  return [...current.slice(0, index), submission, ...current.slice(index)];
}

/** Query params for `GET /api/gallery`, as `hc`'s typed client wants them: only defined keys, all strings. */
export function galleryQueryParams(
  modelId: string | null,
  state: StateFilter,
  cursor: { submittedAt: string; submissionId: string } | null,
): Record<string, string> {
  const params: Record<string, string> = { limit: String(PAGE_LIMIT) };
  if (modelId) params.model = modelId;
  if (state !== "all") params.state = state;
  if (cursor) {
    params.afterSubmittedAt = cursor.submittedAt;
    params.afterSubmissionId = cursor.submissionId;
  }
  return params;
}

/** The cursor for "Load more" / `getNextPageParam`: the last loaded Submission's (submittedAt, id). */
export function cursorFrom(
  submissions: SubmissionSummary[],
): { submittedAt: string; submissionId: string } | null {
  const last = submissions[submissions.length - 1];
  return last
    ? { submittedAt: last.submittedAt, submissionId: last.submissionId }
    : null;
}

/** Removed cards show under "All" only (issue #198's AC): drops a filtered-out state's removed Generations, and the Submission itself once nothing is left. */
export function filterRemovedForState(
  submissions: SubmissionSummary[],
  state: StateFilter,
): SubmissionSummary[] {
  if (state === "all") return submissions;
  return submissions
    .map((submission) => ({
      ...submission,
      generations: submission.generations.filter((g) => !g.removedAt),
    }))
    .filter((submission) => submission.generations.length > 0);
}
