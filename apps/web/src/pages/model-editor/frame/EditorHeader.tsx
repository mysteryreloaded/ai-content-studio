import type { ModelDetail } from "../types.js";
import type { ModelEditor } from "../useModelEditor.js";

export function EditorHeader({
  editor,
  detail,
}: {
  editor: ModelEditor;
  detail: ModelDetail;
}) {
  const {
    goBack,
    togglingState,
    modelHasErrors,
    handleToggleState,
    stateError,
  } = editor;
  return (
    <>
      <button type="button" onClick={goBack}>
        Back to Models
      </button>
      <h2>{detail.model.name}</h2>
      <p>
        State: {detail.model.state} · Revision: {detail.model.currentRevision}
        {" · "}
        <a href={`/api/admin/models/${detail.model.id}/history`}>History</a>
        {" · "}
        <a href={`/api/admin/models/${detail.model.id}/export`}>Export</a>
      </p>

      <button
        type="button"
        disabled={
          togglingState || (detail.model.state !== "enabled" && modelHasErrors)
        }
        onClick={() => void handleToggleState()}
      >
        {detail.model.state === "enabled" ? "Disable" : "Enable"}
      </button>
      {stateError && (
        <ul role="alert">
          {stateError.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      )}
    </>
  );
}
