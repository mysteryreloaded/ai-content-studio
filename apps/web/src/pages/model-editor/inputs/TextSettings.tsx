import type { TextInputDefinition } from "@ai-content-studio/shared";
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
    <>
      <label>
        <input
          type="checkbox"
          checked={input.multiline}
          onChange={(event) =>
            updateInput(index, {
              ...input,
              multiline: event.target.checked,
            })
          }
        />
        Multi-line
      </label>

      <label htmlFor={`input-maxlength-${index}`}>Max length</label>
      <input
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

      <label htmlFor={`input-default-${index}`}>Default (optional)</label>
      <input
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
    </>
  );
}
