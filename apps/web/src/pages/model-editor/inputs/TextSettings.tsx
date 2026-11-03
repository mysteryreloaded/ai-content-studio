import type { TextInputDefinition } from "@ai-content-studio/shared";
import { Input } from "../../../components/ui/input.js";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "../../../components/ui/toggle-group.js";
import { Field } from "../ui/Field.js";
import type { ModelEditor } from "../useModelEditor.js";

export function TextSettings({
  input,
  index,
  editor,
}: {
  input: TextInputDefinition;
  index: number;
  editor: ModelEditor;
}) {
  const { updateInput } = editor;
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">
      <Field label="Max length" htmlFor={`input-maxlength-${index}`}>
        <Input
          id={`input-maxlength-${index}`}
          type="number"
          min={1}
          max={10_000}
          value={input.maxLength}
          onChange={(event) =>
            updateInput(index, {
              ...input,
              maxLength: Number(event.target.value),
            })
          }
        />
      </Field>

      <Field label="Lines">
        <ToggleGroup
          type="single"
          value={input.multiline ? "several" : "one"}
          onValueChange={(value) => {
            if (value) {
              updateInput(index, { ...input, multiline: value === "several" });
            }
          }}
          aria-label="Lines"
        >
          <ToggleGroupItem value="one">One line</ToggleGroupItem>
          <ToggleGroupItem value="several">Several</ToggleGroupItem>
        </ToggleGroup>
      </Field>

      <Field label="Default (optional)" htmlFor={`input-default-${index}`}>
        <Input
          id={`input-default-${index}`}
          value={input.default}
          maxLength={input.maxLength}
          onChange={(event) =>
            updateInput(index, {
              ...input,
              default: event.target.value,
            })
          }
        />
      </Field>
    </div>
  );
}
