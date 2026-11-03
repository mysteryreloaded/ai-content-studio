import { fieldKey } from "@ai-content-studio/shared";
import type { SelectInputDefinition } from "@ai-content-studio/shared";
import { bindingValueKind } from "../helpers/workflow.js";
import type { ModelDetail } from "../types.js";
import type { ModelEditor } from "../useModelEditor.js";
export function SelectSettings({
  input,
  index,
  editor,
  detail,
}: {
  input: SelectInputDefinition;
  index: number;
  editor: ModelEditor;
  detail: ModelDetail;
}) {
  const { updateInput } = editor;
  return (
    <>
      <p>
        Options
        {input.options.length === 2 && " (shown as a toggle)"}:
      </p>
      {input.options.map((option, optionIndex) => (
        <fieldset key={option.id}>
          <label htmlFor={`input-option-label-${index}-${optionIndex}`}>
            Option label
          </label>
          <input
            id={`input-option-label-${index}-${optionIndex}`}
            value={option.label}
            onChange={(event) =>
              updateInput(index, {
                ...input,
                options: input.options.map((o, i) =>
                  i === optionIndex ? { ...o, label: event.target.value } : o,
                ),
              })
            }
          />
          {input.bindings.map((binding, bindingIndex) => {
            const valueKind = bindingValueKind(
              detail.workflow,
              binding.nodeId,
              binding.field,
            );
            const setOptionValue = (value: string | number | boolean) => {
              updateInput(index, {
                ...input,
                options: input.options.map((o, i) =>
                  i === optionIndex
                    ? {
                        ...o,
                        values: o.values.map((v, vi) =>
                          vi === bindingIndex ? value : v,
                        ),
                      }
                    : o,
                ),
              });
            };
            const fieldId = `input-option-value-${index}-${optionIndex}-${bindingIndex}`;
            return (
              <span key={fieldKey(binding.nodeId, binding.field)}>
                <label htmlFor={fieldId}>
                  {binding.nodeId}.{binding.field}
                </label>
                {valueKind === "boolean" ? (
                  <input
                    id={fieldId}
                    type="checkbox"
                    checked={option.values[bindingIndex] === true}
                    onChange={(event) => setOptionValue(event.target.checked)}
                  />
                ) : valueKind === "number" ? (
                  <input
                    id={fieldId}
                    type="number"
                    value={String(option.values[bindingIndex] ?? "")}
                    onChange={(event) =>
                      setOptionValue(Number(event.target.value))
                    }
                  />
                ) : (
                  <input
                    id={fieldId}
                    value={String(option.values[bindingIndex] ?? "")}
                    onChange={(event) => setOptionValue(event.target.value)}
                  />
                )}
              </span>
            );
          })}
          {input.options.length > 2 && (
            <button
              type="button"
              onClick={() =>
                updateInput(index, {
                  ...input,
                  options: input.options.filter((_, i) => i !== optionIndex),
                })
              }
            >
              Remove option
            </button>
          )}
        </fieldset>
      ))}
      {input.options.length < 50 && (
        <button
          type="button"
          onClick={() =>
            updateInput(index, {
              ...input,
              options: [
                ...input.options,
                {
                  id: crypto.randomUUID(),
                  label: "",
                  values: input.bindings.map(() => ""),
                },
              ],
            })
          }
        >
          Add option
        </button>
      )}

      <label htmlFor={`input-default-${index}`}>Default (optional)</label>
      <select
        id={`input-default-${index}`}
        value={input.default ?? ""}
        onChange={(event) =>
          updateInput(index, {
            ...input,
            default: event.target.value || null,
          })
        }
      >
        <option value="">None</option>
        {input.options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label || option.id}
          </option>
        ))}
      </select>
    </>
  );
}
