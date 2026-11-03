import { SubmissionBlock } from "../../components/generations/SubmissionBlock.js";
import type {
  GenerationProgress,
  SubmissionSummary,
} from "../../components/generations/types.js";
import { FirstSubmissionNotifyPrompt } from "../../notifications/FirstSubmissionNotifyPrompt.js";

export function WorkbenchFeed({
  submissions,
  progressById,
  paused,
  cancellingSubmissionIds,
  deletingSubmissionIds,
  cancelErrorSubmissionId,
  deleteErrorSubmissionId,
  onOpen,
  onCancel,
  onDelete,
}: {
  submissions: SubmissionSummary[];
  progressById: Map<string, GenerationProgress>;
  paused: boolean;
  cancellingSubmissionIds: Set<string>;
  deletingSubmissionIds: Set<string>;
  cancelErrorSubmissionId: string | null;
  deleteErrorSubmissionId: string | null;
  onOpen: (submission: SubmissionSummary) => void;
  onCancel: (submissionId: string) => void;
  onDelete: (submissionId: string) => void;
}) {
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
            onCancel={() => onCancel(submission.submissionId)}
            onDelete={() => onDelete(submission.submissionId)}
          />
        ))}
      </ul>
    </aside>
  );
}
