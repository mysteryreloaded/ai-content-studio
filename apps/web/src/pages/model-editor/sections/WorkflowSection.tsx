import { fieldKey } from "@ai-content-studio/shared";
import { ChecksRail } from "../frame/ChecksRail.js";
import type { ModelDetail } from "../types.js";
import type { ModelEditor } from "../useModelEditor.js";
export function WorkflowSection({
  editor,
  detail,
}: {
  editor: ModelEditor;
  detail: ModelDetail;
}) {
  const {
    anyDraftDirty,
    editingInput,
    editingInputCandidates,
    editingMode,
    editingPath,
    handlePickWorkflowFile,
    handleReplaceWorkflow,
    mustDisableToSaveWorkflow,
    nodeFilter,
    pendingWorkflow,
    pendingWorkflowFileName,
    rebindMap,
    setNodeFilter,
    setRebind,
    toggleFieldInEditingInput,
    toggleOutputNodeInEditingMode,
    uploadingWorkflow,
    workflowUploadError,
    brokenNodeRefs,
    pendingWorkflowIssues,
    pendingWorkflowNodes,
  } = editor;
  const filteredNodes = detail.nodes.filter((node) => {
    const needle = nodeFilter.trim().toLowerCase();
    if (!needle) return true;
    return (
      node.id.toLowerCase().includes(needle) ||
      node.classType.toLowerCase().includes(needle) ||
      (node.title ?? "").toLowerCase().includes(needle)
    );
  });
  return (
    <section>
      <h3>Workflow</h3>
      <label htmlFor="replace-workflow-file">
        Replace Workflow (API format JSON)
      </label>
      <input
        id="replace-workflow-file"
        type="file"
        accept="application/json"
        onChange={(event) =>
          void handlePickWorkflowFile(event.target.files?.[0] ?? null)
        }
      />
      {pendingWorkflowFileName && (
        <p>
          Picked "{pendingWorkflowFileName}": Modes' output nodes and Inputs'
          bindings carry forward by node id. Nothing is sent until you press
          "Replace Workflow".
        </p>
      )}
      <ChecksRail issues={pendingWorkflowIssues} />
      {brokenNodeRefs.length > 0 && (
        <section aria-label="Rebind broken bindings and outputs">
          <h4>Rebind</h4>
          <p>
            These no longer match a node of the picked file by class; repoint
            each to a node there instead of disabling the Model.
          </p>
          <table>
            <thead>
              <tr>
                <th>Broken</th>
                <th>Repoint to</th>
              </tr>
            </thead>
            <tbody>
              {brokenNodeRefs.map((ref) => (
                <tr key={ref.nodeId}>
                  <td>{ref.description}</td>
                  <td>
                    <select
                      aria-label={`Rebind node "${ref.nodeId}"`}
                      value={rebindMap[ref.nodeId] ?? ""}
                      onChange={(event) =>
                        setRebind(ref.nodeId, event.target.value)
                      }
                    >
                      <option value="">Leave broken</option>
                      {pendingWorkflowNodes.map((node) => (
                        <option key={node.id} value={node.id}>
                          {node.id} ({node.classType})
                          {node.title ? ` "${node.title}"` : ""}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      <button
        type="button"
        disabled={
          uploadingWorkflow || pendingWorkflow === null || anyDraftDirty
        }
        title={
          anyDraftDirty
            ? "Save or discard your other unsaved changes first"
            : undefined
        }
        onClick={() => void handleReplaceWorkflow()}
      >
        {mustDisableToSaveWorkflow
          ? "Replace Workflow and disable"
          : "Replace Workflow"}
      </button>
      {workflowUploadError && <p role="alert">{workflowUploadError}</p>}
      {editingMode && (
        <p>
          Picking output nodes for "{editingMode.name || "this Mode"}": click a
          row below to add or remove it. Nodes off its Path are dimmed.
        </p>
      )}
      <label htmlFor="node-filter">Filter nodes</label>
      <input
        id="node-filter"
        value={nodeFilter}
        onChange={(event) => setNodeFilter(event.target.value)}
      />
      <table>
        <thead>
          <tr>
            <th>Id</th>
            <th>Class</th>
            <th>Title</th>
            {editingMode && <th>Output node</th>}
          </tr>
        </thead>
        <tbody>
          {filteredNodes.map((node) => {
            const onPath = editingPath
              ? editingPath.nodeIds.has(node.id)
              : true;
            const chosen =
              editingMode?.outputNodeIds.includes(node.id) ?? false;
            return (
              <tr
                key={node.id}
                style={editingPath && !onPath ? { opacity: 0.35 } : undefined}
              >
                <td>{node.id}</td>
                <td>{node.classType}</td>
                <td>{node.title ?? ""}</td>
                {editingMode && (
                  <td>
                    <button
                      type="button"
                      onClick={() => toggleOutputNodeInEditingMode(node.id)}
                    >
                      {chosen ? "Remove" : "Add"}
                    </button>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      {editingInput && editingInputCandidates && (
        <>
          <p>
            Picking fields for "{editingInput.label || "this Input"}": click a
            row below to add or remove it. Only value-holding, type-compatible
            fields not already bound elsewhere are shown.
          </p>
          <table>
            <thead>
              <tr>
                <th>Node</th>
                <th>Field</th>
                <th>Class</th>
                <th>Current value</th>
                <th>Bound</th>
              </tr>
            </thead>
            <tbody>
              {editingInputCandidates.map((field) => {
                const chosen = editingInput.bindings.some(
                  (binding) =>
                    binding.nodeId === field.nodeId &&
                    binding.field === field.field,
                );
                return (
                  <tr key={fieldKey(field.nodeId, field.field)}>
                    <td>{field.nodeId}</td>
                    <td>{field.field}</td>
                    <td>{field.classType}</td>
                    <td>{String(field.value)}</td>
                    <td>
                      <button
                        type="button"
                        onClick={() => toggleFieldInEditingInput(field)}
                      >
                        {chosen ? "Remove" : "Add"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
