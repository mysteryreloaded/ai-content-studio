import {
  firstClickGenerationId,
  hasAnyOutcome,
  isSubmissionEnded,
  outcomeCounts,
} from "./submissionOutcome.js";
import { formatOutcomeCounts } from "./tabTitle.js";
import type { TrackedSubmission } from "./types.js";

export interface NotifyDecisionInput {
  submission: TrackedSubmission;
  /** True once this Submission's end has already been decided, notified or not — never decide twice. */
  alreadyDecided: boolean;
  /** True while any studio tab (this one or another) is in the foreground. */
  anyTabVisible: boolean;
  /** True when this tab (or another, told over BroadcastChannel) cancelled this Submission itself. */
  ownCancelled: boolean;
}

/**
 * Whether a now-ended Submission should raise a Notification (issue #58's
 * AC): one per Submission, none while a studio tab is visible, and never
 * for a Submission the user cancelled themselves or whose Generations were
 * all Removed (nothing left to show).
 */
export function shouldNotify(input: NotifyDecisionInput): boolean {
  if (input.alreadyDecided) return false;
  if (input.anyTabVisible) return false;
  if (input.ownCancelled) return false;
  if (!isSubmissionEnded(input.submission)) return false;
  return hasAnyOutcome(outcomeCounts(input.submission));
}

export interface NotificationContent {
  title: string;
  body: string;
}

/** Title = site title, body = counts + Model + Mode — never the prompt or files (issue #58's AC). */
export function buildNotificationContent(
  submission: TrackedSubmission,
  siteTitle: string,
): NotificationContent {
  const counts = outcomeCounts(submission);
  return {
    title: siteTitle,
    body: `${formatOutcomeCounts(counts)} — ${submission.modelName} · ${submission.modeName}`,
  };
}

/** A click opens the first succeeded Generation, else the first failed one. */
export function notificationClickTarget(
  submission: TrackedSubmission,
): string | null {
  return firstClickGenerationId(submission);
}
