import type { NumberInputDefinition } from "@ai-content-studio/shared";
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
    <>
      <label htmlFor={`input-mode-${index}`}>Number</label>
      <select
        id={`input-mode-${index}`}
        value={input.numberMode}
        onChange={(event) =>
          updateInput(index, {
            ...input,
            numberMode: event.target
              .value as NumberInputDefinition["numberMode"],
          })
        }
      >
        <option value="integer">Whole</option>
        <option value="decimal">Decimal</option>
      </select>

      <label htmlFor={`input-min-${index}`}>Min</label>
      <input
        id={`input-min-${index}`}
        type="number"
        value={input.min}
        onChange={(event) =>
          updateInput(index, {
            ...input,
            min: Number(event.target.value),
          })
        }
      />

      <label htmlFor={`input-max-${index}`}>Max</label>
      <input
        id={`input-max-${index}`}
        type="number"
        value={input.max}
        onChange={(event) =>
          updateInput(index, {
            ...input,
            max: Number(event.target.value),
          })
        }
      />

      <label htmlFor={`input-step-${index}`}>Step</label>
      <input
        id={`input-step-${index}`}
        type="number"
        min={0}
        value={input.step}
        onChange={(event) =>
          updateInput(index, {
            ...input,
            step: Number(event.target.value),
          })
        }
      />

      <label htmlFor={`input-default-${index}`}>Default (optional)</label>
      <input
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
    </>
  );
}
