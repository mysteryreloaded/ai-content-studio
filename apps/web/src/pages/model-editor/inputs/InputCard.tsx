import { fieldKey } from "@ai-content-studio/shared";
import type { InputDefinition } from "@ai-content-studio/shared";
import { toggleBinding } from "../helpers/bindings.js";
import type { ModelDetail } from "../types.js";
import type { ModelEditor } from "../useModelEditor.js";
import { NumberSettings } from "./NumberSettings.js";
import { PointsSettings } from "./PointsSettings.js";
import { SeedSettings } from "./SeedSettings.js";
import { SelectSettings } from "./SelectSettings.js";
import { TextSettings } from "./TextSettings.js";
import { UploadSettings } from "./UploadSettings.js";
export function InputCard({
  input,
  index,
  editor,
  detail,
}: {
  input: InputDefinition;
  index: number;
  editor: ModelEditor;
  detail: ModelDetail;
}) {
  const { updateInput, editingInputIndex, setEditingInputIndex, removeInput } =
    editor;
  return (
    <fieldset>
      <p>Kind: {input.kind}</p>

      <label htmlFor={`input-group-${index}`}>Group</label>
      <select
        id={`input-group-${index}`}
        value={input.group}
        onChange={(event) =>
          updateInput(index, {
            ...input,
            group: event.target.value as InputDefinition["group"],
          })
        }
      >
        <option value="describe">Describe it</option>
        <option value="settings">Settings</option>
      </select>

      <label htmlFor={`input-label-${index}`}>Label</label>
      <input
        id={`input-label-${index}`}
        value={input.label}
        maxLength={60}
        onChange={(event) =>
          updateInput(index, { ...input, label: event.target.value })
        }
      />

      <label htmlFor={`input-help-${index}`}>Help (optional)</label>
      <input
        id={`input-help-${index}`}
        value={input.help}
        onChange={(event) =>
          updateInput(index, { ...input, help: event.target.value })
        }
      />

      {input.kind === "text" && (
        <TextSettings input={input} index={index} editor={editor} />
      )}

      {input.kind === "image_upload" && (
        <UploadSettings input={input} index={index} editor={editor} />
      )}

      {(input.kind === "video_upload" || input.kind === "audio_upload") && (
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

      {input.kind === "number" && (
        <NumberSettings input={input} index={index} editor={editor} />
      )}

      {input.kind === "seed" && (
        <SeedSettings input={input} index={index} editor={editor} />
      )}

      {input.kind === "select" && (
        <SelectSettings
          input={input}
          index={index}
          editor={editor}
          detail={detail}
        />
      )}

      <p>Bound fields: {input.bindings.length === 0 ? "none chosen" : null}</p>
      <ul>
        {input.bindings.map((binding) => (
          <li key={fieldKey(binding.nodeId, binding.field)}>
            {binding.nodeId}.{binding.field} ({binding.classType})
            <button
              type="button"
              onClick={() =>
                updateInput(
                  index,
                  toggleBinding(input, {
                    nodeId: binding.nodeId,
                    field: binding.field,
                    classType: binding.classType,
                    title: binding.title,
                    valueType: input.kind === "number" ? "number" : "string",
                    value: "",
                  }),
                )
              }
            >
              Remove
            </button>
          </li>
        ))}
      </ul>

      <button
        type="button"
        aria-pressed={editingInputIndex === index}
        onClick={() =>
          setEditingInputIndex(editingInputIndex === index ? null : index)
        }
      >
        {editingInputIndex === index
          ? "Done picking fields"
          : "Pick fields in the Workflow below"}
      </button>
      <button type="button" onClick={() => removeInput(index)}>
        Remove Input
      </button>
    </fieldset>
  );
}
