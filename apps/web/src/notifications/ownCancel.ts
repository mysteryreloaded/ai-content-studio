import { postTabMessage, subscribeTabChannel } from "./crossTab.js";

// A Submission the user cancelled themselves never raises a Notification
// (issue #58's AC), no matter which tab the Cancel button was pressed in
// or which tab ends up electing itself the Notifier.
const cancelledSubmissionIds = new Set<string>();

// The same for a single Generation's own Cancel button (issue #189's AC):
// cancelling one Generation never raises the "Cancelled" Notification for
// it, no matter which tab it was pressed in — without touching the
// Submission's other Generations, which may still end on their own.
const cancelledGenerationIds = new Set<string>();

subscribeTabChannel((message) => {
  if (message.type === "ownCancel")
    cancelledSubmissionIds.add(message.submissionId);
  else if (message.type === "ownCancelGeneration")
    cancelledGenerationIds.add(message.generationId);
});

/** Called by the Workbench's own Cancel button once the server accepts the request. */
export function markOwnCancel(submissionId: string): void {
  cancelledSubmissionIds.add(submissionId);
  postTabMessage({ type: "ownCancel", submissionId });
}

/** Called by one Generation's own Cancel button once the server accepts the request (issue #189). */
export function markOwnCancelGeneration(generationId: string): void {
  cancelledGenerationIds.add(generationId);
  postTabMessage({ type: "ownCancelGeneration", generationId });
}

export function isOwnCancelled(submissionId: string): boolean {
  return cancelledSubmissionIds.has(submissionId);
}

export function isOwnCancelledGeneration(generationId: string): boolean {
  return cancelledGenerationIds.has(generationId);
}
