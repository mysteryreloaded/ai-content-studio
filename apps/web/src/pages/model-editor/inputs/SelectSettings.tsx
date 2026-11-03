import { fieldKey } from "@ai-content-studio/shared";
import type { SelectInputDefinition } from "@ai-content-studio/shared";
import { Plus, X } from "lucide-react";
import { Button } from "../../../components/ui/button.js";
import { Input } from "../../../components/ui/input.js";
import { Label } from "../../../components/ui/label.js";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../../components/ui/table.js";
import { bindingValueKind, comboOptionsFor } from "../helpers/workflow.js";
import type { ModelDetail } from "../types.js";
import type { ModelEditor } from "../useModelEditor.js";
import { OptionValueInput } from "./OptionValueInput.js";

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
  const { updateInput, checkModelBackends } = editor;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          Options: the value each writes into each field
        </span>
        {input.options.length < 50 && (
          <Button
            type="button"
            size="sm"
            variant="outline"
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
            <Plus data-icon="inline-start" /> Option
          </Button>
        )}
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="min-w-[120px]">Option label</TableHead>
            {input.bindings.map((binding) => (
              <TableHead
                key={fieldKey(binding.nodeId, binding.field)}
                className="min-w-[130px] font-mono"
              >
                {binding.title ?? binding.nodeId}.{binding.field}
              </TableHead>
            ))}
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {input.options.map((option, optionIndex) => (
            <TableRow key={option.id}>
              <TableCell className="min-w-[120px]">
                <Label
                  htmlFor={`input-option-label-${index}-${optionIndex}`}
                  className="sr-only"
                >
                  Option label
                </Label>
                <Input
                  id={`input-option-label-${index}-${optionIndex}`}
                  value={option.label}
                  onChange={(event) =>
                    updateInput(index, {
                      ...input,
                      options: input.options.map((o, i) =>
                        i === optionIndex
                          ? { ...o, label: event.target.value }
                          : o,
                      ),
                    })
                  }
                />
              </TableCell>
              {input.bindings.map((binding, bindingIndex) => {
                const valueKind = bindingValueKind(
                  detail.workflow,
                  binding.nodeId,
                  binding.field,
                );
                const comboOptions = comboOptionsFor(
                  checkModelBackends,
                  binding.classType,
                  binding.field,
                );
                const fieldId = `input-option-value-${index}-${optionIndex}-${bindingIndex}`;
                const label = `${option.label || `Option ${optionIndex + 1}`} value for ${binding.title ?? binding.nodeId}.${binding.field}`;
                return (
                  <TableCell
                    key={fieldKey(binding.nodeId, binding.field)}
                    className="min-w-[130px]"
                  >
                    <OptionValueInput
                      id={fieldId}
                      label={label}
                      valueKind={valueKind}
                      comboOptions={comboOptions}
                      value={option.values[bindingIndex] ?? null}
                      onChange={(value) =>
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
                        })
                      }
                    />
                  </TableCell>
                );
              })}
              <TableCell>
                {input.options.length > 2 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label="Remove option"
                    onClick={() =>
                      updateInput(index, {
                        ...input,
                        options: input.options.filter(
                          (_, i) => i !== optionIndex,
                        ),
                      })
                    }
                  >
                    <X />
                  </Button>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {input.options.length === 2 && (
        <p className="text-[12.5px] text-muted-foreground">
          Two options show as a switch on the Model page.
        </p>
      )}

      <div className="flex flex-col gap-1">
        <Label htmlFor={`input-default-${index}`}>Default (optional)</Label>
        <select
          id={`input-default-${index}`}
          value={input.default ?? ""}
          onChange={(event) =>
            updateInput(index, {
              ...input,
              default: event.target.value || null,
            })
          }
          className="h-10 w-fit min-w-0 rounded-lg border border-input bg-transparent px-3 text-base"
        >
          <option value="">None</option>
          {input.options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label || option.id}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
