import { modeBackendGaps } from "@ai-content-studio/shared";
import type { ModelDetail } from "../types.js";
import type { ModelEditor } from "../useModelEditor.js";

export function BackendsSection({
  editor,
  detail,
}: {
  editor: ModelEditor;
  detail: ModelDetail;
}) {
  const {
    allBackends,
    attachBackendId,
    attachedBackends,
    attachError,
    backendsLoadError,
    checkModelBackends,
    handleAttach,
    handleDetach,
    modesDraft,
    setAttachBackendId,
  } = editor;
  return (
    <section>
      <h3>Backends</h3>
      {backendsLoadError && <p role="alert">{backendsLoadError}</p>}

      {attachedBackends && attachedBackends.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Base URL</th>
              <th>Missing node types</th>
              <th>Can't run</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {attachedBackends.map((entry) => {
              const thisBackend = checkModelBackends?.find(
                (b) => b.id === entry.backend.id,
              );
              const gapsByMode =
                detail && modesDraft && thisBackend
                  ? modesDraft
                      .filter((mode) => mode.outputNodeIds.length > 0)
                      .flatMap((mode) => {
                        const checkMode = {
                          id: mode.key,
                          name: mode.name,
                          outputNodeIds: mode.outputNodeIds,
                          inputSettings: mode.inputSettings,
                        };
                        return modeBackendGaps(
                          {
                            workflow: detail.workflow,
                            inputs: detail.inputs ?? [],
                            modes: [checkMode],
                          },
                          checkMode,
                          [thisBackend],
                        )
                          .filter((gap) => gap.missingNodeType !== null)
                          .map((gap) => ({ mode, gap }));
                      })
                  : [];
              return (
                <tr key={entry.backend.id} data-backend-row={entry.backend.id}>
                  <td>{entry.backend.name}</td>
                  <td>{entry.backend.baseUrl}</td>
                  <td>
                    {entry.note
                      ? entry.note
                      : entry.missingNodeTypes &&
                          entry.missingNodeTypes.length > 0
                        ? entry.missingNodeTypes.join(", ")
                        : "none"}
                  </td>
                  <td>
                    {gapsByMode.length === 0
                      ? "every Mode"
                      : gapsByMode.map(({ mode, gap }) => (
                          <div key={mode.key}>
                            Can't run "{mode.name || "this Mode"}": missing{" "}
                            {gap.missingNodeType} (pack {gap.pack ?? "unknown"})
                          </div>
                        ))}
                  </td>
                  <td>
                    <button
                      type="button"
                      onClick={() => void handleDetach(entry.backend.id)}
                    >
                      Detach
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {attachedBackends && attachedBackends.length === 0 && (
        <p>No Backends attached.</p>
      )}

      <form onSubmit={(event) => void handleAttach(event)}>
        <label htmlFor="attach-backend">Attach a Backend</label>
        <select
          id="attach-backend"
          value={attachBackendId}
          onChange={(event) => setAttachBackendId(event.target.value)}
        >
          <option value="">Choose a Backend…</option>
          {(allBackends ?? [])
            .filter(
              (backend) =>
                !attachedBackends?.some(
                  (entry) => entry.backend.id === backend.id,
                ),
            )
            .map((backend) => (
              <option key={backend.id} value={backend.id}>
                {backend.name}
              </option>
            ))}
        </select>
        <button type="submit" disabled={!attachBackendId}>
          Attach
        </button>
        {attachError && <p role="alert">{attachError}</p>}
      </form>
    </section>
  );
}
