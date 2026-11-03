import type { ModelIssue } from "@ai-content-studio/shared";
import { Button } from "../../../components/ui/button.js";
import { Input } from "../../../components/ui/input.js";
import { UserFormPreview } from "../preview/UserFormPreview.js";
import type { DraftMode, ModelDetail } from "../types.js";
import { ChecksList } from "../ui/ChecksList.js";
import { Field } from "../ui/Field.js";
import type { ModelEditor } from "../useModelEditor.js";
import { OutputsEditor } from "./OutputsEditor.js";
import { PathFacts } from "./PathFacts.js";

/**
 * A Mode sheet's body (issue #216): the Mode editor on the left, "What
 * users see" (the live form preview) sticky on the right, one column on
 * phones.
 */
export function ModeSheetContent({
  mode,
  modeIndex,
  detail,
  editor,
  modelIssues,
  onJumpToIssue,
  onClose,
  onDuplicated,
}: {
  mode: DraftMode;
  modeIndex: number;
  detail: ModelDetail;
  editor: ModelEditor;
  modelIssues: ModelIssue[];
  onJumpToIssue: (issue: ModelIssue) => void;
  onClose: () => void;
  onDuplicated: (newModeKey: string) => void;
}) {
  const {
    updateMode,
    addOutputNode,
    replaceOutputNode,
    moveOutputNode,
    removeOutputNode,
    duplicateMode,
    removeMode,
    inputsDraft,
  } = editor;
  const inputs = inputsDraft ?? detail.inputs ?? [];

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_340px] gap-4 @max-[760px]:grid-cols-1">
      <div className="flex flex-col gap-5">
        <Field label="Name" htmlFor={`mode-name-${mode.key}`}>
          <Input
            id={`mode-name-${mode.key}`}
            value={mode.name}
            maxLength={60}
            onChange={(event) =>
              updateMode(modeIndex, { name: event.target.value })
            }
          />
        </Field>

        <Field label="Description" htmlFor={`mode-description-${mode.key}`}>
          <Input
            id={`mode-description-${mode.key}`}
            value={mode.description}
            onChange={(event) =>
              updateMode(modeIndex, { description: event.target.value })
            }
          />
        </Field>

        <OutputsEditor
          mode={mode}
          detail={detail}
          onAdd={(nodeId) => addOutputNode(modeIndex, nodeId)}
          onReplace={(oldNodeId, newNodeId) =>
            replaceOutputNode(modeIndex, oldNodeId, newNodeId)
          }
          onMove={(nodeId, direction) =>
            moveOutputNode(modeIndex, nodeId, direction)
          }
          onRemove={(nodeId) => removeOutputNode(modeIndex, nodeId)}
        />

        <PathFacts mode={mode} detail={detail} inputs={inputs} />

        <ChecksList
          issues={modelIssues}
          title="This Mode"
          filter={(issue) => issue.modeId === mode.key}
          onJump={onJumpToIssue}
        />

        <div className="flex justify-between gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              const newKey = duplicateMode(modeIndex);
              if (newKey) onDuplicated(newKey);
            }}
          >
            Duplicate Mode
          </Button>
          <Button
            type="button"
            variant="danger"
            onClick={() => {
              removeMode(modeIndex);
              onClose();
            }}
          >
            Delete Mode
          </Button>
        </div>
      </div>

      <section aria-label="What users see" className="sticky top-4 self-start">
        <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          What users see
        </div>
        <div className="mt-2">
          <UserFormPreview
            modelName={detail.model.name}
            attribution={detail.model.attribution}
            mode={mode}
            inputs={inputs}
            workflow={detail.workflow}
          />
        </div>
      </section>
    </div>
  );
}
