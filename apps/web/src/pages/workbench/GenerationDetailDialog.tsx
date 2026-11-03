import { useEffect, useRef } from "react";
import type { SubmissionSummary } from "../../components/generations/types.js";
import type { WorkbenchModel } from "./types.js";

interface GenerationDetail {
  submission: SubmissionSummary;
  model: WorkbenchModel;
}

/** The Generation detail dialog (issue #61): a Submission's own state plus the Model's Attribution and terms link. */
export function GenerationDetailDialog({
  detail,
  onClose,
}: {
  detail: GenerationDetail;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
  }, []);

  return (
    <dialog ref={dialogRef} onClose={onClose}>
      <h2>{detail.submission.modeName}</h2>
      <time dateTime={detail.submission.submittedAt}>
        {new Date(detail.submission.submittedAt).toLocaleString()}
      </time>
      <ul>
        {detail.submission.generations.map((generation) => (
          <li key={generation.id}>{generation.state}</li>
        ))}
      </ul>
      {detail.model.attribution && <p>{detail.model.attribution}</p>}
      <button type="button" onClick={() => dialogRef.current?.close()}>
        Close
      </button>
    </dialog>
  );
}
