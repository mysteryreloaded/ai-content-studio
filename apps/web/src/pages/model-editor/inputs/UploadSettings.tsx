import type {
  AudioUploadInputDefinition,
  ImageUploadInputDefinition,
  VideoUploadInputDefinition,
} from "@ai-content-studio/shared";
import { Checkbox } from "../../../components/ui/checkbox.js";
import { Input } from "../../../components/ui/input.js";
import { Field } from "../ui/Field.js";
import type { ModelEditor } from "../useModelEditor.js";

const MS_PER_SECOND = 1000;

function msToSeconds(ms: number): number {
  return ms / MS_PER_SECOND;
}

function secondsToMs(value: string): number {
  return Math.round(Number(value) * MS_PER_SECOND);
}

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
    <div className="flex flex-col gap-3">
      <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        Upload limits
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">
        <Field
          label="Max size (MB)"
          htmlFor={`input-max-size-${index}`}
          hint={maxUploadMb ? `Up to ${maxUploadMb} MB.` : undefined}
        >
          <Input
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
        </Field>

        {input.kind !== "audio_upload" && (
          <Field
            label="Max long side (px)"
            htmlFor={`input-max-long-side-${index}`}
          >
            <Input
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
          </Field>
        )}

        {input.kind !== "image_upload" && (
          <>
            <Field
              label="Min duration (s)"
              htmlFor={`input-min-duration-${index}`}
            >
              <Input
                id={`input-min-duration-${index}`}
                type="number"
                min={0}
                step={0.1}
                value={msToSeconds(input.minDurationMs)}
                onChange={(event) =>
                  updateInput(index, {
                    ...input,
                    minDurationMs: secondsToMs(event.target.value),
                  })
                }
              />
            </Field>

            <Field
              label="Max duration (s)"
              htmlFor={`input-max-duration-${index}`}
            >
              <Input
                id={`input-max-duration-${index}`}
                type="number"
                min={0.1}
                step={0.1}
                value={msToSeconds(input.maxDurationMs)}
                onChange={(event) =>
                  updateInput(index, {
                    ...input,
                    maxDurationMs: secondsToMs(event.target.value),
                  })
                }
              />
            </Field>
          </>
        )}
      </div>

      {input.kind !== "image_upload" && (
        <label
          htmlFor={`input-trimmable-${index}`}
          className="flex items-center gap-2 text-[13px]"
        >
          <Checkbox
            id={`input-trimmable-${index}`}
            checked={input.trimmable}
            onCheckedChange={(checked) =>
              updateInput(index, { ...input, trimmable: checked === true })
            }
          />
          Users can trim it before submitting
        </label>
      )}

      <p className="text-[12.5px] text-muted-foreground">
        Shown under "Your files" and always required.
      </p>
    </div>
  );
}
