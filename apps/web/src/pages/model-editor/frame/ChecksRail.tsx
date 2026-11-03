import type { ModelIssue } from "@ai-content-studio/shared";
import { Label } from "../../../components/ui/label.js";
import { Switch } from "../../../components/ui/switch.js";
import type { EditorNavigation } from "../hooks/useEditorNavigation.js";
import { sectionForIssue } from "../hooks/useModelChecks.js";
import type { ModelDetail } from "../types.js";
import { ChecksList } from "../ui/ChecksList.js";
import type { ModelEditor } from "../useModelEditor.js";

/**
 * The prototype's `.va-rail` (issue #213): the enable switch, then a
 * divider, then "Checks" — every error and warning `checkModel` finds
 * right now, each jumping to its place.
 */
export function ChecksRail({
  editor,
  detail,
  nav,
}: {
  editor: ModelEditor;
  detail: ModelDetail;
  nav: EditorNavigation;
}) {
  const {
    togglingState,
    handleToggleState,
    stateError,
    modelIssues,
    modelHasErrors,
  } = editor;
  const enabled = detail.model.state === "enabled";
  const errorCount = modelIssues.filter((i) => i.severity === "error").length;

  function jump(issue: ModelIssue) {
    if (issue.backendId) {
      nav.focusBackend(issue.backendId);
      return;
    }
    if (issue.inputId && issue.modeId) {
      nav.openCell(issue.modeId, issue.inputId);
      return;
    }
    if (issue.inputId) {
      nav.openInput(issue.inputId);
      return;
    }
    if (issue.modeId) {
      nav.openMode(issue.modeId);
      return;
    }
    nav.setSection(sectionForIssue(issue));
  }

  return (
    <aside className="bg-card border-l border-border px-3 py-3.5 @max-[1180px]:col-span-full @max-[1180px]:border-l-0 @max-[1180px]:border-t">
      <div className="sticky top-[calc(var(--app-header-h)+60px)] flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <Switch
              id="model-enable-switch"
              checked={enabled}
              disabled={togglingState || (!enabled && modelHasErrors)}
              onCheckedChange={() => void handleToggleState()}
            />
            <Label htmlFor="model-enable-switch" className="font-medium">
              {enabled
                ? "Enabled: users can see it"
                : "Disabled: hidden from users"}
            </Label>
          </div>
          {!enabled && modelHasErrors && (
            <p className="text-[12.5px] text-err">
              Fix {errorCount} error(s) to enable.
            </p>
          )}
          {enabled && modelHasErrors && (
            <p className="text-[12.5px] text-warn">
              Saving now will disable it until the errors are fixed.
            </p>
          )}
          {stateError && (
            <ul
              role="alert"
              className="flex flex-col gap-0.5 text-[12.5px] text-err"
            >
              {stateError.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          )}
        </div>

        <hr className="border-border" />

        <ChecksList issues={modelIssues} onJump={jump} />
      </div>
    </aside>
  );
}
