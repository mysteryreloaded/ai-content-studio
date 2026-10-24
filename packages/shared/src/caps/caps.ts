import { z } from "zod";

/**
 * Issue #53: the daily Cap counts the rolling 24h, excluding failed
 * Generations; the concurrent Cap counts queued through saving. Site
 * defaults are Admin-editable (audited); a per-user override (0-1,000,
 * where 0 blocks generating) is stored on the user, edited in a later
 * (user-management) ticket.
 */
export const DEFAULT_DAILY_CAP = 20;
export const DEFAULT_CONCURRENT_CAP = 4;
export const SITE_CAP_MIN = 1;
export const SITE_CAP_MAX = 1_000;
export const USER_CAP_OVERRIDE_MIN = 0;
export const USER_CAP_OVERRIDE_MAX = 1_000;

export const siteCapsFieldsSchema = z.object({
  dailyCap: z.coerce.number().int().min(SITE_CAP_MIN).max(SITE_CAP_MAX),
  concurrentCap: z.coerce.number().int().min(SITE_CAP_MIN).max(SITE_CAP_MAX),
});

export type SiteCapsFields = z.infer<typeof siteCapsFieldsSchema>;

export const userCapOverrideSchema = z
  .number()
  .int()
  .min(USER_CAP_OVERRIDE_MIN)
  .max(USER_CAP_OVERRIDE_MAX)
  .nullable();

/** A user's effective Caps: the Site default unless they have an override. */
export function effectiveCap(siteCap: number, override: number | null): number {
  return override ?? siteCap;
}

/** What the Workbench foot needs to show this user's Caps (issue #53's AC). */
export interface CapsStatus {
  dailyCap: number;
  dailyUsed: number;
  concurrentCap: number;
  concurrentUsed: number;
  /** The oldest Generation counted toward the rolling daily Cap, ISO, or null when none are counted: when it ages out of the 24h window, a daily slot frees. */
  oldestCountedSubmittedAt: string | null;
}

export const DAY_MS = 24 * 60 * 60 * 1000;

/** Remaining today, never negative (a lowered Cap or override can leave `dailyUsed` over it). */
export function dailyRemaining(status: CapsStatus): number {
  return Math.max(0, status.dailyCap - status.dailyUsed);
}

/** Remaining at once, never negative. */
export function concurrentRemaining(status: CapsStatus): number {
  return Math.max(0, status.concurrentCap - status.concurrentUsed);
}

/** Below this, the Workbench foot also says when the next daily slot frees. */
export const LOW_DAILY_REMAINING_THRESHOLD = 3;

function formatDuration(ms: number): string {
  const totalMinutes = Math.max(0, Math.round(ms / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  return `${minutes}m`;
}

/**
 * The Workbench foot's own text (issue #53's AC: "22 of 30 left today · 2
 * more at once"), with a third clause naming when the next daily slot
 * frees once `dailyRemaining` is low. The concurrent Cap has no such
 * clause: it frees whenever any of the user's own unfinished Generations
 * finishes, which has no predictable time, unlike the daily Cap's fixed
 * 24h rolling window.
 */
export function capsFooterText(status: CapsStatus, now: Date): string {
  const daily = dailyRemaining(status);
  const concurrent = concurrentRemaining(status);
  let text = `${daily} of ${status.dailyCap} left today · ${concurrent} more at once`;

  if (
    daily <= LOW_DAILY_REMAINING_THRESHOLD &&
    status.oldestCountedSubmittedAt
  ) {
    const freesAt =
      new Date(status.oldestCountedSubmittedAt).getTime() + DAY_MS;
    const remainingMs = freesAt - now.getTime();
    text +=
      remainingMs <= 0
        ? " · next slot free now"
        : ` · next slot frees in ${formatDuration(remainingMs)}`;
  }

  return text;
}
