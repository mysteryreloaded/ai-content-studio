import {
  modeBackendGaps,
  relevantInputs,
  resolveModeInputs,
  toWorkbenchInput,
  visibleModeBoundFields,
} from "@ai-content-studio/shared";
import type { CheckModelMode } from "@ai-content-studio/shared";
import { Play } from "lucide-react";
import { useEffect } from "react";
import { FormField } from "../../../components/admin/FormField.js";
import { Button } from "../../../components/ui/button.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../components/ui/select.js";
import { workflowForMode } from "../helpers/workflow.js";
import type { TestSectionData } from "../hooks/useTestSection.js";
import { UserFormPreview } from "../preview/UserFormPreview.js";
import { RecentTests } from "../test/RecentTests.js";
import { TestResultPanel } from "../test/TestResultPanel.js";
import type { ModelDetail } from "../types.js";
import { Section } from "../ui/Section.js";
import type { ModelEditor } from "../useModelEditor.js";

export function TestSection({
  editor,
  detail,
  // Issue #266: the section's data comes from the page's own
  // `useTestSection` call, so the form's state survives a section
  // switch (and the section's own remount) for the editor's lifetime.
  test,
}: {
  editor: ModelEditor;
  detail: ModelDetail;
  test: TestSectionData;
}) {
  const { modesDraft, inputsDraft, backends, checkModelBackends, modelIssues } =
    editor;
  const { attachedBackends } = backends;
  const modes = modesDraft ?? [];
  const inputs = inputsDraft ?? detail.inputs ?? [];

  // Issue #259: a fresh editor session starts on the first Mode.
  // biome-ignore lint/correctness/useExhaustiveDependencies: a one-shot default, not a reset on every Modes edit
  useEffect(() => {
    if (test.modeKey === null && modes.length > 0) {
      test.selectMode(modes[0]?.key as string);
    }
  }, [modes.length]);

  const mode = modes.find((m) => m.key === test.modeKey) ?? null;

  const checkMode: CheckModelMode | null = mode
    ? {
        id: mode.key,
        name: mode.name,
        outputNodeIds: mode.outputNodeIds,
        inputSettings: mode.inputSettings,
      }
    : null;
  const checkModel = {
    workflow: detail.workflow,
    inputs,
    modes: checkMode ? [checkMode] : [],
  };

  const eligibleBackends = (attachedBackends ?? []).filter((entry) => {
    const cb = checkModelBackends?.find((b) => b.id === entry.backend.id);
    if (!cb || !cb.reachable || !cb.enabled || !checkMode) return false;
    return modeBackendGaps(checkModel, checkMode, [cb]).length === 0;
  });

  const modeErrorCount = mode
    ? modelIssues.filter(
        (issue) => issue.severity === "error" && issue.modeId === mode.key,
      ).length
    : 0;

  let unfilledLabels: string[] = [];
  let workflow = detail.workflow;
  if (mode) {
    workflow = workflowForMode(mode, inputs, detail.workflow);
    const unresolvable = visibleModeBoundFields(
      mode.inputSettings ?? [],
      inputs,
    );
    const relevant =
      mode.outputNodeIds.length === 0
        ? []
        : relevantInputs(inputs, workflow, mode.outputNodeIds, unresolvable);
    const { formInputs, requiredIds } = resolveModeInputs(
      relevant,
      mode.inputSettings ?? [],
    );
    const workbenchInputs = formInputs.map((input) =>
      toWorkbenchInput(input, workflow, requiredIds.has(input.id), formInputs),
    );
    unfilledLabels = workbenchInputs
      .filter(
        (input) => requiredIds.has(input.id) && !(test.values[input.id] ?? ""),
      )
      .map((input) => input.label);
  }

  const blockReason =
    !mode || mode.outputNodeIds.length === 0
      ? "Pick a Mode with at least one output node first."
      : modeErrorCount > 0
        ? `${mode.name || "This Mode"} has ${modeErrorCount} error(s) to fix first.`
        : eligibleBackends.length === 0
          ? "Attach a healthy Backend first."
          : unfilledLabels.length > 0
            ? `Fill ${unfilledLabels.join(", ")}.`
            : null;

  const latestRun = test.testRuns[0];

  return (
    <Section
      title="Test Generation"
      sub="Run one Mode end to end before enabling the Model."
    >
      <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
        <FormField label="Mode" htmlFor="test-mode">
          <Select
            value={test.modeKey ?? ""}
            onValueChange={(value) => test.selectMode(value)}
          >
            <SelectTrigger id="test-mode" className="w-full">
              <SelectValue placeholder="Pick a Mode" />
            </SelectTrigger>
            <SelectContent>
              {modes.map((m) => (
                <SelectItem key={m.key} value={m.key}>
                  {m.name || "Untitled Mode"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>

        <FormField label="Backend" htmlFor="test-backend">
          <Select
            value={test.backendId || "any"}
            onValueChange={(value) =>
              test.setBackendId(value === "any" ? "" : value)
            }
          >
            <SelectTrigger id="test-backend" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="any">Any attached</SelectItem>
              {eligibleBackends.map((entry) => (
                <SelectItem key={entry.backend.id} value={entry.backend.id}>
                  {entry.backend.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
      </div>

      <p className="text-muted-foreground">
        A test runs this draft, unsaved changes included, on the Backend you
        pick. It shows on the Admin Generations page and doesn't count toward
        your Caps.
      </p>

      {mode && (
        <UserFormPreview
          modelName={detail.model.name}
          attribution={detail.model.attribution}
          mode={mode}
          inputs={inputs}
          workflow={workflow}
          interactive
          hideSubmit
          hideCountPicker
          values={test.values}
          onValuesChange={test.setValues}
          uploads={test.uploads}
          trimRangeByInputId={test.trimRangeByInputId}
          onTrimRangeChange={test.onTrimRangeChange}
          onPick={test.onPick}
          onClearUpload={test.onClear}
        />
      )}

      <div className="flex flex-wrap items-center gap-2.5">
        <Button
          type="button"
          disabled={Boolean(blockReason) || test.submitting}
          onClick={() => mode && void test.handleSubmit(mode, inputs)}
        >
          <Play /> Run test Generation
        </Button>
        {blockReason && (
          <span className="text-muted-foreground">{blockReason}</span>
        )}
      </div>

      {test.error && (
        <ul role="alert" className="text-err">
          {test.error.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      )}

      {test.testsLoadError && <p className="text-err">{test.testsLoadError}</p>}

      {latestRun && (
        <TestResultPanel
          run={latestRun}
          progress={test.progressById.get(latestRun.id)}
          cancelling={test.cancellingIds.has(latestRun.id)}
          onCancel={() => void test.cancel(latestRun.id)}
          // Issue #266: the error is tied to the run it belongs to, so a
          // later Run test (a new run) doesn't show a stale alert under
          // it — only the latest run's own refused Cancel shows.
          cancelError={
            test.cancelError?.generationId === latestRun.id
              ? test.cancelError.message
              : null
          }
        />
      )}

      <RecentTests runs={test.testRuns} />
    </Section>
  );
}
