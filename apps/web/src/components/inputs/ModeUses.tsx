import { AudioLines, Crosshair, Image, Video } from "lucide-react";
import type { ComponentType } from "react";
import type { WorkbenchMode } from "../../pages/workbench/types.js";
import { UPLOAD_KINDS } from "./types.js";

const KIND_ICON: Record<string, ComponentType<{ className?: string }>> = {
  image_upload: Image,
  video_upload: Video,
  audio_upload: AudioLines,
  points: Crosshair,
};

/**
 * A Mode's shown Uploads and points Input, icon + label (prototype
 * `ModeUses`, issue #194 step 6): "Prompt only" when it uses none.
 */
export function ModeUses({ mode }: { mode: WorkbenchMode }) {
  const uses = mode.inputs.filter(
    (input) => UPLOAD_KINDS.has(input.kind) || input.kind === "points",
  );
  if (uses.length === 0) {
    return <span className="text-[12.5px] text-faint">Prompt only</span>;
  }
  return (
    <span className="flex flex-wrap gap-x-2.5 gap-y-1 text-[12.5px] text-faint">
      {uses.map((input) => {
        const Icon = KIND_ICON[input.kind];
        return (
          <span
            key={input.id}
            className={
              input.required
                ? "inline-flex items-center gap-1"
                : "inline-flex items-center gap-1 opacity-75"
            }
          >
            {Icon && <Icon className="size-3" />}
            {input.label}
            {!input.required && " (optional)"}
          </span>
        );
      })}
    </span>
  );
}
