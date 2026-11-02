import type { SeedInputDefinition } from "@ai-content-studio/shared";
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
    <>
      <p>Bound to exactly one INT field; no default (issue #47).</p>
      <label htmlFor={`input-max-${index}`}>
        Max (required to enable this Model)
      </label>
      <input
        id={`input-max-${index}`}
        type="number"
        min={1}
        value={input.max ?? ""}
        onChange={(event) =>
          updateInput(index, {
            ...input,
            max: event.target.value === "" ? null : Number(event.target.value),
          })
        }
      />
    </>
  );
}
