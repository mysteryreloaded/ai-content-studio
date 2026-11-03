import { fieldKey, modeInputSetting } from "@ai-content-studio/shared";
import type { InputDefinition, ModelIssue } from "@ai-content-studio/shared";
import { CircleAlert, Plus, TriangleAlert, X } from "lucide-react";
import { useState } from "react";
import { Button } from "../../../components/ui/button.js";
import { Input } from "../../../components/ui/input.js";
import {
  isBindingBroken,
  rebindBinding,
  toggleBinding,
} from "../helpers/bindings.js";
import { changeInputKind } from "../helpers/newInputs.js";
import type { ModelDetail } from "../types.js";
import { Field } from "../ui/Field.js";
import { StateChip } from "../ui/StateChip.js";
import {
  TypeDot,
  typeDotKindFor,
  typeDotKindForValueType,
} from "../ui/TypeDot.js";
import type { ModelEditor } from "../useModelEditor.js";
import { BindingPicker } from "../workflow/BindingPicker.js";
import { NumberSettings } from "./NumberSettings.js";
import { PointsSettings } from "./PointsSettings.js";
import { SeedSettings } from "./SeedSettings.js";
import { SelectSettings } from "./SelectSettings.js";
import { TextSettings } from "./TextSettings.js";
import { UploadSettings } from "./UploadSettings.js";
import { INPUT_TYPE_OPTIONS } from "./inputTypeOptions.js";

/** The prototype's `.callout` (issue #215): every check about this Input, error first. */
function InputCallouts({ issues }: { issues: ModelIssue[] }) {
  if (issues.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5">
      {issues.map((issue, i) => (
        <div
          key={`${issue.severity}-${i}`}
          role="alert"
          className={`flex items-start gap-2 rounded-r-md border border-l-[3px] px-3 py-[9px] text-[13px] ${
            issue.severity === "error"
              ? "border-border border-l-err bg-err-soft"
              : "border-border border-l-warn bg-warn-soft"
          }`}
        >
          {issue.severity === "error" ? (
            <CircleAlert
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0 text-err"
            />
          ) : (
            <TriangleAlert
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0 text-warn"
            />
          )}
          <span>{issue.message}</span>
        </div>
      ))}
    </div>
  );
}

export function InputEditor({
  input,
  index,
  editor,
  detail,
  modelIssues,
  onDeleted,
}: {
  input: InputDefinition;
  index: number;
  editor: ModelEditor;
  detail: ModelDetail;
  modelIssues: ModelIssue[];
  onDeleted: () => void;
}) {
  const { updateInput, removeInput, inputsDraft, modesDraft } = editor;
  const [bindingPickerOpen, setBindingPickerOpen] = useState(false);
  const [rebindTarget, setRebindTarget] = useState<{
    nodeId: string;
    field: string;
    classType: string;
    title: string | null;
  } | null>(null);

  const inputIssues = modelIssues.filter((issue) => issue.inputId === input.id);
  const otherInputs = (inputsDraft ?? detail.inputs ?? []).filter(
    (other) => other.id !== input.id,
  );

  return (
    <div className="flex flex-col gap-5">
      <InputCallouts issues={inputIssues} />

      <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">
        <Field
          label="Label"
          htmlFor={`input-label-${index}`}
          hint='Put units in the label, e.g. "Duration (s)".'
        >
          <Input
            id={`input-label-${index}`}
            value={input.label}
            maxLength={60}
            onChange={(event) =>
              updateInput(index, { ...input, label: event.target.value })
            }
          />
        </Field>

        <Field
          label="Type"
          htmlFor={`input-type-${index}`}
          hint={
            input.bindings.length > 0
              ? "Remove its bindings to change the type."
              : undefined
          }
        >
          <select
            id={`input-type-${index}`}
            value={input.kind}
            disabled={input.bindings.length > 0}
            onChange={(event) =>
              updateInput(
                index,
                changeInputKind(
                  input,
                  event.target.value as InputDefinition["kind"],
                ),
              )
            }
            className="h-10 w-full min-w-0 rounded-lg border border-input bg-transparent px-3 text-base disabled:cursor-not-allowed disabled:opacity-50"
          >
            {INPUT_TYPE_OPTIONS.map((type) => (
              <option key={type.kind} value={type.kind}>
                {type.label}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Field
        label="Help text (optional)"
        htmlFor={`input-help-${index}`}
        hint="Shown under the field on the Model page."
      >
        <Input
          id={`input-help-${index}`}
          value={input.help}
          onChange={(event) =>
            updateInput(index, { ...input, help: event.target.value })
          }
        />
      </Field>

      {input.kind === "text" && (
        <TextSettings input={input} index={index} editor={editor} />
      )}
      {input.kind === "number" && (
        <NumberSettings input={input} index={index} editor={editor} />
      )}
      {input.kind === "seed" && (
        <SeedSettings input={input} index={index} editor={editor} />
      )}
      {(input.kind === "image_upload" ||
        input.kind === "video_upload" ||
        input.kind === "audio_upload") && (
        <UploadSettings input={input} index={index} editor={editor} />
      )}
      {input.kind === "points" && (
        <PointsSettings
          input={input}
          index={index}
          editor={editor}
          detail={detail}
        />
      )}

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            Writes into these Node fields
          </span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setBindingPickerOpen(true)}
          >
            <Plus data-icon="inline-start" /> Bind a field
          </Button>
        </div>

        {input.bindings.length === 0 && (
          <p className="text-[12.5px] text-muted-foreground">
            Not bound yet. Each Input writes its value into one or more Node
            fields.
          </p>
        )}

        {input.bindings.length > 0 && (
          <div className="flex flex-col rounded-md border border-border">
            {input.bindings.map((binding) => {
              const broken = isBindingBroken(detail.workflow, binding);
              const node = detail.workflow[binding.nodeId];
              const workflowValue = node?.inputs[binding.field];
              return (
                <div
                  key={fieldKey(binding.nodeId, binding.field)}
                  className={`flex items-center gap-2 border-b border-border px-2.5 py-1.5 text-[13px] last:border-b-0 ${
                    broken ? "bg-err-soft" : ""
                  }`}
                >
                  <TypeDot
                    kind={
                      broken
                        ? "string"
                        : typeDotKindForValueType(
                            typeof workflowValue === "number"
                              ? "number"
                              : typeof workflowValue === "boolean"
                                ? "boolean"
                                : "string",
                          )
                    }
                  />
                  {broken ? (
                    <span className="flex-1">
                      <strong className="font-mono">
                        #{binding.nodeId}.{binding.field}
                      </strong>{" "}
                      <span className="text-err">isn't in this Workflow</span>
                    </span>
                  ) : (
                    <span className="flex-1">
                      <strong>{binding.title ?? binding.nodeId}</strong>
                      <span className="font-mono">.{binding.field}</span>{" "}
                      <span className="font-mono text-faint">
                        #{binding.nodeId}
                      </span>
                      <br />
                      <span className="text-muted-foreground">
                        {binding.classType} · Workflow value{" "}
                        {workflowValue === undefined || workflowValue === null
                          ? "—"
                          : String(workflowValue)}
                      </span>
                    </span>
                  )}
                  {broken && (
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => setRebindTarget(binding)}
                    >
                      Rebind
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label="Remove binding"
                    onClick={() =>
                      updateInput(
                        index,
                        toggleBinding(input, {
                          nodeId: binding.nodeId,
                          field: binding.field,
                          classType: binding.classType,
                          title: binding.title,
                          valueType:
                            input.kind === "number" ? "number" : "string",
                          value: "",
                        }),
                      )
                    }
                  >
                    <X />
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <BindingPicker
        open={bindingPickerOpen}
        onOpenChange={setBindingPickerOpen}
        input={input}
        workflow={detail.workflow}
        otherInputs={otherInputs}
        onBind={(field) => {
          updateInput(index, toggleBinding(input, field));
          setBindingPickerOpen(false);
        }}
      />

      {rebindTarget && (
        <BindingPicker
          open
          onOpenChange={(open) => {
            if (!open) setRebindTarget(null);
          }}
          input={input}
          workflow={detail.workflow}
          otherInputs={otherInputs}
          savedBinding={rebindTarget}
          onBind={(field) => {
            updateInput(index, rebindBinding(input, rebindTarget, field));
            setRebindTarget(null);
          }}
        />
      )}

      {input.kind === "select" && (
        <SelectSettings
          input={input}
          index={index}
          editor={editor}
          detail={detail}
        />
      )}

      {modesDraft && modesDraft.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            In each Mode
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {modesDraft.map((mode) => {
              const setting = modeInputSetting(mode.inputSettings, input.id);
              return (
                <span
                  key={mode.key}
                  className="flex items-center gap-1.5 text-[13px]"
                >
                  <span className="text-muted-foreground">
                    {mode.name || "Untitled Mode"}
                  </span>
                  <StateChip
                    state={setting.state}
                    fixedValue={setting.fixedValue}
                  />
                </span>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex justify-end">
        <Button
          type="button"
          variant="danger"
          size="sm"
          onClick={() => {
            removeInput(index);
            onDeleted();
          }}
        >
          Delete Input
        </Button>
      </div>
    </div>
  );
}
