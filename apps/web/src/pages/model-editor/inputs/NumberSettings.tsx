import type { NumberInputDefinition } from "@ai-content-studio/shared";
import { Input } from "../../../components/ui/input.js";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "../../../components/ui/toggle-group.js";
import { Field } from "../ui/Field.js";
import type { ModelEditor } from "../useModelEditor.js";

export function NumberSettings({
  input,
  index,
  editor,
}: {
  input: NumberInputDefinition;
  index: number;
  editor: ModelEditor;
}) {
  const { updateInput } = editor;
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">
      <Field label="Number">
        <ToggleGroup
          type="single"
          value={input.numberMode}
          onValueChange={(value) => {
            if (value) {
              updateInput(index, {
                ...input,
                numberMode: value as NumberInputDefinition["numberMode"],
              });
            }
          }}
          aria-label="Number"
        >
          <ToggleGroupItem value="integer">Whole</ToggleGroupItem>
          <ToggleGroupItem value="decimal">Decimal</ToggleGroupItem>
        </ToggleGroup>
      </Field>

      <Field label="Min" htmlFor={`input-min-${index}`}>
        <Input
          id={`input-min-${index}`}
          type="number"
          value={input.min}
          onChange={(event) =>
            updateInput(index, { ...input, min: Number(event.target.value) })
          }
        />
      </Field>

      <Field label="Max" htmlFor={`input-max-${index}`}>
        <Input
          id={`input-max-${index}`}
          type="number"
          value={input.max}
          onChange={(event) =>
            updateInput(index, { ...input, max: Number(event.target.value) })
          }
        />
      </Field>

      <Field label="Step" htmlFor={`input-step-${index}`}>
        <Input
          id={`input-step-${index}`}
          type="number"
          min={0}
          value={input.step}
          onChange={(event) =>
            updateInput(index, { ...input, step: Number(event.target.value) })
          }
        />
      </Field>

      <Field label="Default (optional)" htmlFor={`input-default-${index}`}>
        <Input
          id={`input-default-${index}`}
          type="number"
          value={input.default ?? ""}
          onChange={(event) =>
            updateInput(index, {
              ...input,
              default:
                event.target.value === "" ? null : Number(event.target.value),
            })
          }
        />
      </Field>
    </div>
  );
}
