import { postTabMessage, subscribeTabChannel } from "./crossTab.js";

// A Submission the user cancelled themselves never raises a Notification
// (issue #58's AC), no matter which tab the Cancel button was pressed in
// or which tab ends up electing itself the Notifier.
const cancelledSubmissionIds = new Set<string>();

subscribeTabChannel((message) => {
  if (message.type === "ownCancel")
    cancelledSubmissionIds.add(message.submissionId);
});

/** Called by the Workbench's own Cancel button once the server accepts the request. */
export function markOwnCancel(submissionId: string): void {
  cancelledSubmissionIds.add(submissionId);
  postTabMessage({ type: "ownCancel", submissionId });
}

export function isOwnCancelled(submissionId: string): boolean {
  return cancelledSubmissionIds.has(submissionId);
}
