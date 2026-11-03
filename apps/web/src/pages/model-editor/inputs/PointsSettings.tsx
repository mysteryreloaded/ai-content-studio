import type {
  NodeFieldRef,
  PointsInputDefinition,
  VideoUploadInputDefinition,
} from "@ai-content-studio/shared";
import { useState } from "react";
import { Button } from "../../../components/ui/button.js";
import { Label } from "../../../components/ui/label.js";
import type { ModelDetail } from "../types.js";
import type { ModelEditor } from "../useModelEditor.js";
import { BindingPicker } from "../workflow/BindingPicker.js";

const FIELD_LABELS = {
  widthField: "Width field",
  heightField: "Height field",
} as const;

function refLabel(detail: ModelDetail, ref: NodeFieldRef): string {
  if (!ref.nodeId) return "Pick a field";
  const node = detail.nodes.find((n) => n.id === ref.nodeId);
  const title = node?.title ?? node?.classType ?? ref.nodeId;
  return `${title}.${ref.field} #${ref.nodeId}`;
}

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
  const [picking, setPicking] = useState<"widthField" | "heightField" | null>(
    null,
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`input-video-${index}`}>Video Input</Label>
        <select
          id={`input-video-${index}`}
          value={input.videoInputId}
          onChange={(event) =>
            updateInput(index, {
              ...input,
              videoInputId: event.target.value,
            })
          }
          className="h-10 w-fit min-w-0 rounded-lg border border-input bg-transparent px-3 text-base"
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
      </div>

      <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">
        {(["widthField", "heightField"] as const).map((key) => (
          <div key={key} className="flex flex-col gap-1.5">
            <Label htmlFor={`input-${key}-${index}`}>{FIELD_LABELS[key]}</Label>
            <Button
              id={`input-${key}-${index}`}
              type="button"
              variant="outline"
              size="sm"
              className="w-fit font-mono"
              onClick={() => setPicking(key)}
            >
              {refLabel(detail, input[key])}
            </Button>
          </div>
        ))}
      </div>

      <p className="text-[12.5px] text-muted-foreground">
        Users click 1–10 points on the first frame of the trimmed video, inside
        the crop the Width and Height fields resolve to.
      </p>

      {picking && (
        <BindingPicker
          open
          onOpenChange={(open) => {
            if (!open) setPicking(null);
          }}
          input={input}
          workflow={detail.workflow}
          otherInputs={[]}
          restrictToValueType="number"
          titleOverride={`Pick a ${FIELD_LABELS[picking].replace(" field", "")} field (an INT field)`}
          onBind={(field) => {
            updateInput(index, {
              ...input,
              [picking]: { nodeId: field.nodeId, field: field.field },
            });
            setPicking(null);
          }}
        />
      )}
    </div>
  );
}
