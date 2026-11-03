import type {
  AudioUploadInputDefinition,
  ImageUploadInputDefinition,
  VideoUploadInputDefinition,
} from "@ai-content-studio/shared";
import type { ModelEditor } from "../useModelEditor.js";
export function UploadSettings({
  input,
  index,
  editor,
}: {
  input:
    | ImageUploadInputDefinition
    | VideoUploadInputDefinition
    | AudioUploadInputDefinition;
  index: number;
  editor: ModelEditor;
}) {
  const { maxUploadMb, updateInput } = editor;
  return (
    <>
      {input.kind === "image_upload" && (
        <>
          <p>
            Shown under "Your files" and always required. Bind it to a loader's
            file field, such as LoadImage's "image".
          </p>
          <label htmlFor={`input-max-size-${index}`}>Max size (MB)</label>
          <input
            id={`input-max-size-${index}`}
            type="number"
            min={1}
            max={maxUploadMb}
            step={1}
            value={input.maxSizeMb}
            onChange={(event) =>
              updateInput(index, {
                ...input,
                maxSizeMb: Number(event.target.value),
              })
            }
          />

          <label htmlFor={`input-max-long-side-${index}`}>
            Max long side (px, optional)
          </label>
          <input
            id={`input-max-long-side-${index}`}
            type="number"
            min={1}
            step={1}
            value={input.maxLongSide ?? ""}
            onChange={(event) =>
              updateInput(index, {
                ...input,
                maxLongSide:
                  event.target.value === "" ? null : Number(event.target.value),
              })
            }
          />
        </>
      )}

      {(input.kind === "video_upload" || input.kind === "audio_upload") && (
        <>
          <p>
            Shown under "Your media" and always required. Bind it to a loader's
            file field
            {input.kind === "video_upload"
              ? " flagged video_upload, or to VHS_LoadVideo/VHS_LoadVideoFFmpeg."
              : " flagged audio_upload."}
          </p>
          <label htmlFor={`input-max-size-${index}`}>Max size (MB)</label>
          <input
            id={`input-max-size-${index}`}
            type="number"
            min={1}
            max={maxUploadMb}
            step={1}
            value={input.maxSizeMb}
            onChange={(event) =>
              updateInput(index, {
                ...input,
                maxSizeMb: Number(event.target.value),
              })
            }
          />

          {input.kind === "video_upload" && (
            <>
              <label htmlFor={`input-max-long-side-${index}`}>
                Max long side (px, optional)
              </label>
              <input
                id={`input-max-long-side-${index}`}
                type="number"
                min={1}
                step={1}
                value={input.maxLongSide ?? ""}
                onChange={(event) =>
                  updateInput(index, {
                    ...input,
                    maxLongSide:
                      event.target.value === ""
                        ? null
                        : Number(event.target.value),
                  })
                }
              />
            </>
          )}

          <label htmlFor={`input-min-duration-${index}`}>
            Min duration (ms)
          </label>
          <input
            id={`input-min-duration-${index}`}
            type="number"
            min={0}
            step={100}
            value={input.minDurationMs}
            onChange={(event) =>
              updateInput(index, {
                ...input,
                minDurationMs: Number(event.target.value),
              })
            }
          />

          <label htmlFor={`input-max-duration-${index}`}>
            Max duration (ms)
          </label>
          <input
            id={`input-max-duration-${index}`}
            type="number"
            min={1}
            step={100}
            value={input.maxDurationMs}
            onChange={(event) =>
              updateInput(index, {
                ...input,
                maxDurationMs: Number(event.target.value),
              })
            }
          />

          <label>
            <input
              type="checkbox"
              checked={input.trimmable}
              onChange={(event) =>
                updateInput(index, {
                  ...input,
                  trimmable: event.target.checked,
                })
              }
            />
            Trimmable on a local player
          </label>
        </>
      )}
    </>
  );
}
