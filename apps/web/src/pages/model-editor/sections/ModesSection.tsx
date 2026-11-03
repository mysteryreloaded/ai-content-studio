import { ModeInputGrid } from "../modes/ModeInputGrid.js";
import { ModeSheetFacts } from "../modes/ModeSheetFacts.js";
import { RecentTests } from "../test/RecentTests.js";
import { TestPanel } from "../test/TestPanel.js";
import type { ModelDetail } from "../types.js";
import type { ModelEditor } from "../useModelEditor.js";

export function ModesSection({
  editor,
  detail,
}: {
  editor: ModelEditor;
  detail: ModelDetail;
}) {
  const {
    addMode,
    applySettingToEveryEligibleMode,
    attachedBackends,
    duplicateMode,
    editingModeIndex,
    handleTestSubmit,
    inputsDraft,
    modesDraft,
    modesHeadingRef,
    moveOutputNode,
    removeMode,
    removeOutputNode,
    setEditingModeIndex,
    setModeInputSetting,
    setTestBackendId,
    setTestTrimRangeByInputId,
    setTestValues,
    startTestUpload,
    clearTestUpload,
    testBackendId,
    testError,
    testOpenForModeKey,
    testRuns,
    testSubmitting,
    testTrimRangeByInputId,
    testUploads,
    testValues,
    toggleTestForm,
    updateMode,
  } = editor;
  return (
    <section>
      <h3 ref={modesHeadingRef}>Modes</h3>
      {modesDraft?.map((mode, index) => (
        <fieldset key={mode.key}>
          <label htmlFor={`mode-name-${index}`}>Mode name</label>
          <input
            id={`mode-name-${index}`}
            value={mode.name}
            maxLength={60}
            onChange={(event) =>
              updateMode(index, { name: event.target.value })
            }
          />

          <label htmlFor={`mode-description-${index}`}>Mode description</label>
          <input
            id={`mode-description-${index}`}
            value={mode.description}
            onChange={(event) =>
              updateMode(index, { description: event.target.value })
            }
          />

          <p>
            Output nodes (first is the main Asset):{" "}
            {mode.outputNodeIds.length === 0 ? "none chosen" : null}
          </p>
          <ol>
            {mode.outputNodeIds.map((nodeId, position) => (
              <li key={nodeId}>
                {nodeId}
                <button
                  type="button"
                  onClick={() => moveOutputNode(index, nodeId, "up")}
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => moveOutputNode(index, nodeId, "down")}
                >
                  ↓
                </button>
                <button
                  type="button"
                  onClick={() => removeOutputNode(index, nodeId)}
                >
                  Remove
                </button>
                {position === 0 && " (main Asset)"}
              </li>
            ))}
          </ol>

          {detail && <ModeSheetFacts mode={mode} detail={detail} />}

          <button type="button" onClick={() => toggleTestForm(mode)}>
            {testOpenForModeKey === mode.key ? "Close test" : "Test"}
          </button>
          {detail && testOpenForModeKey === mode.key && (
            <TestPanel
              mode={mode}
              detail={detail}
              inputsDraft={inputsDraft ?? detail.inputs ?? []}
              attachedBackends={attachedBackends}
              values={testValues}
              onValuesChange={setTestValues}
              uploads={testUploads}
              onPick={(input, file) => startTestUpload(input, file)}
              onClear={(input) => clearTestUpload(input)}
              trimRangeByInputId={testTrimRangeByInputId}
              onTrimRangeChange={(inputId, range) =>
                setTestTrimRangeByInputId((ranges) => ({
                  ...ranges,
                  [inputId]: range,
                }))
              }
              backendId={testBackendId}
              onBackendIdChange={setTestBackendId}
              submitting={testSubmitting}
              errors={testError}
              onSubmit={() => void handleTestSubmit(mode)}
            />
          )}

          <button
            type="button"
            aria-pressed={editingModeIndex === index}
            onClick={() =>
              setEditingModeIndex(editingModeIndex === index ? null : index)
            }
          >
            {editingModeIndex === index
              ? "Done picking output nodes"
              : "Pick output nodes in the Workflow below"}
          </button>
          <button type="button" onClick={() => duplicateMode(index)}>
            Duplicate Mode
          </button>
          <button type="button" onClick={() => removeMode(index)}>
            Remove Mode
          </button>
        </fieldset>
      ))}

      <button type="button" onClick={addMode}>
        Add Mode
      </button>

      {detail && modesDraft && modesDraft.length > 0 && (
        <ModeInputGrid
          modes={modesDraft}
          inputs={detail.inputs}
          workflow={detail.workflow}
          onChange={setModeInputSetting}
          onApplyToEveryEligibleMode={applySettingToEveryEligibleMode}
        />
      )}

      {testRuns.length > 0 && <RecentTests runs={testRuns} />}
    </section>
  );
}
