import type { OutcomeCounts } from "./submissionOutcome.js";

export interface UnderwayCue {
  /** Generations still under way across every Submission this tab is tracking. */
  count: number;
  /** The Model of the most recently submitted Submission still under way. */
  modelName: string;
}

/** "(2) LTX 2.5 · My Studio" (issue #58's AC) while work is under way in a hidden tab. */
export function underwayTitle(cue: UnderwayCue, siteTitle: string): string {
  return `(${cue.count}) ${cue.modelName} · ${siteTitle}`;
}

/** "3 ready" / "1 failed" / "3 ready · 1 failed", shared by the tab title and the Notification body. */
export function formatOutcomeCounts(counts: OutcomeCounts): string {
  const parts: string[] = [];
  if (counts.ready > 0) parts.push(`${counts.ready} ready`);
  if (counts.failed > 0) parts.push(`${counts.failed} failed`);
  return parts.join(" · ");
}

/** "✓ 3 ready · 1 failed · My Studio" (✕ if nothing succeeded), accumulated since the tab last became visible. */
export function endedTitle(counts: OutcomeCounts, siteTitle: string): string {
  const mark = counts.ready > 0 ? "✓" : "✕";
  return `${mark} ${formatOutcomeCounts(counts)} · ${siteTitle}`;
}

export type FaviconDot = "accent" | "failure" | null;

/** Accent when at least one Generation succeeded, the failure colour only when every one of them failed. */
export function faviconDotFor(counts: OutcomeCounts | null): FaviconDot {
  if (!counts || counts.ready + counts.failed === 0) return null;
  return counts.ready > 0 ? "accent" : "failure";
}
