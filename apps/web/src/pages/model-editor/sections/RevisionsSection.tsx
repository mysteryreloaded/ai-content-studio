import type { ModelDetail } from "../types.js";
import type { ModelEditor } from "../useModelEditor.js";

export function RevisionsSection({
  editor,
  detail,
}: {
  editor: ModelEditor;
  detail: ModelDetail;
}) {
  const {
    anyDraftDirty,
    handleRestoreRevision,
    restoreErrors,
    restoringRevision,
    revisions,
    revisionsLoadError,
  } = editor;
  return (
    <section>
      <h3>Revisions</h3>
      {revisionsLoadError && <p role="alert">{revisionsLoadError}</p>}
      {revisions && revisions.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Revision</th>
              <th>Created</th>
              <th>Modes</th>
              <th>Inputs</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {revisions.map((revision) => (
              <tr key={revision.revisionNumber}>
                <td>
                  {revision.revisionNumber}
                  {revision.revisionNumber === detail.model.currentRevision &&
                    " (current)"}
                </td>
                <td>{new Date(revision.createdAt).toLocaleString()}</td>
                <td>{revision.modeCount}</td>
                <td>{revision.inputCount}</td>
                <td>
                  <a
                    href={`/api/admin/models/${detail.model.id}/revisions/${revision.revisionNumber}/export`}
                  >
                    Export
                  </a>{" "}
                  <button
                    type="button"
                    disabled={
                      restoringRevision !== null ||
                      revision.revisionNumber ===
                        detail.model.currentRevision ||
                      anyDraftDirty
                    }
                    title={
                      anyDraftDirty
                        ? "Save or discard your other unsaved changes first"
                        : undefined
                    }
                    onClick={() =>
                      void handleRestoreRevision(revision.revisionNumber, false)
                    }
                  >
                    Restore
                  </button>
                  {restoreErrors[revision.revisionNumber] && (
                    <>
                      <p role="alert">
                        {restoreErrors[revision.revisionNumber]}
                      </p>
                      {detail.model.state === "enabled" && (
                        <button
                          type="button"
                          disabled={restoringRevision !== null || anyDraftDirty}
                          title={
                            anyDraftDirty
                              ? "Save or discard your other unsaved changes first"
                              : undefined
                          }
                          onClick={() =>
                            void handleRestoreRevision(
                              revision.revisionNumber,
                              true,
                            )
                          }
                        >
                          Restore and disable
                        </button>
                      )}
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
