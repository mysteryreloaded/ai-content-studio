import { SubmissionBlock } from "../../components/generations/SubmissionBlock.js";
import { FirstSubmissionNotifyPrompt } from "../../notifications/FirstSubmissionNotifyPrompt.js";
import type { WorkbenchFeedProps } from "./types.js";

export function WorkbenchFeed({
  submissions,
  progressById,
  paused,
  cancellingSubmissionIds,
  deletingSubmissionIds,
  cancelErrorSubmissionId,
  deleteErrorSubmissionId,
  onOpen,
  handleCancelSubmission,
  handleDeleteSubmission,
}: WorkbenchFeedProps) {
  return (
    <aside className="workbench-submissions" aria-label="Submissions">
      <h2>Submissions</h2>
      {submissions.length === 0 && <p>No Submissions yet.</p>}
      {submissions.length > 0 && <FirstSubmissionNotifyPrompt />}
      <ul>
        {submissions.map((submission) => (
          <SubmissionBlock
            key={submission.submissionId}
            submission={submission}
            progressById={progressById}
            paused={paused}
            cancelling={cancellingSubmissionIds.has(submission.submissionId)}
            deleting={deletingSubmissionIds.has(submission.submissionId)}
            cancelError={cancelErrorSubmissionId === submission.submissionId}
            deleteError={deleteErrorSubmissionId === submission.submissionId}
            onOpen={() => onOpen(submission)}
            onCancel={() => handleCancelSubmission(submission.submissionId)}
            onDelete={() => handleDeleteSubmission(submission.submissionId)}
          />
        ))}
      </ul>
    </aside>
  );
}
