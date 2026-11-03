import { fieldKey } from "@ai-content-studio/shared";
import type {
  NodeFieldRef,
  PointsInputDefinition,
  VideoUploadInputDefinition,
} from "@ai-content-studio/shared";
import { numberFieldsFor } from "../helpers/bindings.js";
import type { ModelDetail } from "../types.js";
import type { ModelEditor } from "../useModelEditor.js";
export function PointsSettings({
  input,
  index,
  editor,
  detail,
}: {
  input: PointsInputDefinition;
  index: number;
  editor: ModelEditor;
  detail: ModelDetail;
}) {
  const { inputsDraft, updateInput } = editor;
  return (
    <>
      <p>
        A user picks 1-10 points on the first frame of the chosen Video Upload
        Input's trimmed clip, inside the crop the Width/Height fields resolve
        to. Bind its own field (the resolved pixel points, as a JSON string)
        below.
      </p>

      <label htmlFor={`input-video-${index}`}>Video Upload Input</label>
      <select
        id={`input-video-${index}`}
        value={input.videoInputId}
        onChange={(event) =>
          updateInput(index, {
            ...input,
            videoInputId: event.target.value,
          })
        }
      >
        <option value="">(choose one)</option>
        {inputsDraft
          ?.filter(
            (other): other is VideoUploadInputDefinition =>
              other.kind === "video_upload",
          )
          .map((videoInput) => (
            <option key={videoInput.id} value={videoInput.id}>
              {videoInput.label || videoInput.id}
            </option>
          ))}
      </select>

      {(["widthField", "heightField"] as const).map((key) => {
        const ref = input[key];
        return (
          <div key={key}>
            <label htmlFor={`input-${key}-${index}`}>
              {key === "widthField" ? "Width" : "Height"} field
            </label>
            <select
              id={`input-${key}-${index}`}
              value={ref.nodeId ? fieldKey(ref.nodeId, ref.field) : ""}
              onChange={(event) => {
                const value = event.target.value;
                const nextRef: NodeFieldRef =
                  value === ""
                    ? { nodeId: "", field: "" }
                    : {
                        nodeId: value.slice(0, value.indexOf("::")),
                        field: value.slice(value.indexOf("::") + 2),
                      };
                updateInput(index, { ...input, [key]: nextRef });
              }}
            >
              <option value="">(choose one)</option>
              {numberFieldsFor(detail.workflow).map((field) => (
                <option
                  key={fieldKey(field.nodeId, field.field)}
                  value={fieldKey(field.nodeId, field.field)}
                >
                  {field.nodeId}.{field.field} ({field.classType})
                </option>
              ))}
            </select>
          </div>
        );
      })}
    </>
  );
}
