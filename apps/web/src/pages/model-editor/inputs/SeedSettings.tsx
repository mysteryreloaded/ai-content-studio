import type { SeedInputDefinition } from "@ai-content-studio/shared";
import { Input } from "../../../components/ui/input.js";
import { Field } from "../ui/Field.js";
import type { ModelEditor } from "../useModelEditor.js";

export function SeedSettings({
  input,
  index,
  editor,
}: {
  input: SeedInputDefinition;
  index: number;
  editor: ModelEditor;
}) {
  const { updateInput } = editor;
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">
        <Field
          label="Max"
          htmlFor={`input-max-${index}`}
          hint="Required to enable this Model."
        >
          <Input
            id={`input-max-${index}`}
            type="number"
            min={1}
            value={input.max ?? ""}
            onChange={(event) =>
              updateInput(index, {
                ...input,
                max:
                  event.target.value === "" ? null : Number(event.target.value),
              })
            }
          />
        </Field>
      </div>
      <p className="text-[12.5px] text-muted-foreground">
        A blank seed gives each Generation in a Submission its own random seed.
        The count picker shows in every Mode whose Path holds these fields, even
        when the seed is hidden.
      </p>
    </div>
  );
}
