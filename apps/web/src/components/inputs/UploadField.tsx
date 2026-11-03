import { AudioLines, Image, Video, X } from "lucide-react";
import { Button } from "../ui/button.js";
import { Field, fieldDescribedBy } from "./Field.js";
import { FilePicker } from "./FilePicker.js";
import { Trimmer } from "./Trimmer.js";
import { UploadStatus } from "./UploadStatus.js";
import { UploadThumb } from "./UploadThumb.js";
import type {
  ImageUploadInput,
  MediaUploadInput,
  TrimRange,
  UploadState,
} from "./types.js";

const IMAGE_ACCEPT = "image/png,image/jpeg,image/webp";
const VIDEO_ACCEPT = ".mp4,.mov,.webm,.mkv";
const AUDIO_ACCEPT = ".wav,.mp3,.flac,.ogg,.opus,.m4a,.aac";

function kindOf(
  input: ImageUploadInput | MediaUploadInput,
): "image" | "video" | "audio" {
  if (input.kind === "image_upload") return "image";
  return input.kind === "video_upload" ? "video" : "audio";
}

/** A number of seconds without a trailing `.0` (the prototype's own style for its limit text and info line). */
function fmtSec(ms: number): string {
  return String(Number((ms / 1000).toFixed(1)));
}

/** "up to 50 MB, 2048 px, trim to 1–10 s" (issue #197's `UploadControl` limit text). */
function limitsText(input: ImageUploadInput | MediaUploadInput): string {
  const parts = [`up to ${input.maxSizeMb} MB`];
  if (input.kind !== "audio_upload" && input.maxLongSide !== null) {
    parts.push(`${input.maxLongSide} px`);
  }
  if (input.kind !== "image_upload") {
    const trim = input.trimmable ? "trim to " : "";
    const min =
      input.minDurationMs > 0 ? `${fmtSec(input.minDurationMs)}–` : "";
    parts.push(`${trim}${min}${fmtSec(input.maxDurationMs)} s`);
  }
  return parts.join(", ");
}

/**
 * One image, video or audio Upload Input (issue #197): the dashed drop
 * zone empty, the filled Upload card (thumbnail, status, Replace,
 * Remove) once a file's picked, and the `Trimmer` below it when the
 * Input's trimmable and the Upload's complete and playable here.
 */
export function UploadField({
  input,
  upload,
  trimRange,
  onTrimRangeChange,
  onPick,
  onClear,
  needsPlayableVideo = false,
  issue,
}: {
  input: ImageUploadInput | MediaUploadInput;
  upload: UploadState | undefined;
  trimRange: TrimRange | undefined;
  onTrimRangeChange: (range: TrimRange) => void;
  onPick: (file: File, needsPlayableVideo: boolean) => void;
  onClear: () => void;
  needsPlayableVideo?: boolean;
  issue: string | undefined;
}) {
  const kind = kindOf(input);
  const accept =
    kind === "image"
      ? IMAGE_ACCEPT
      : kind === "video"
        ? VIDEO_ACCEPT
        : AUDIO_ACCEPT;
  const error =
    upload?.status === "error"
      ? upload.message
      : upload?.status === "uploading"
        ? undefined
        : issue;
  const describedBy = fieldDescribedBy(input.id, input.help, error);
  const mediaInput = input.kind !== "image_upload" ? input : null;
  const canTrim =
    mediaInput?.trimmable &&
    upload?.status === "complete" &&
    upload.durationMs !== null &&
    upload.browserPlayable !== false;
  // CEO review round 1 (prototype's own `refuseUpload`): a refused pick
  // never reaches "filled", so it shows the dashed drop zone again (with
  // the err border/message above, from `error`), not a card that looks
  // attached to a file nothing was actually sent for.
  const showDropZone = !upload || upload.status === "error";
  const Icon = kind === "video" ? Video : kind === "audio" ? AudioLines : Image;
  const chooseLabel =
    kind === "image"
      ? "an image"
      : kind === "video"
        ? "a video"
        : "an audio file";

  return (
    <Field
      id={input.id}
      label={input.label}
      optional={!input.required}
      help={input.help}
      error={error}
    >
      {showDropZone ? (
        <FilePicker
          id={input.id}
          accept={accept}
          invalid={Boolean(error)}
          describedBy={describedBy}
          onPick={(file) => onPick(file, needsPlayableVideo)}
          className="flex flex-col items-start gap-1.5 rounded-xl border-[1.5px] border-dashed border-input bg-card p-3 data-[over=true]:border-primary data-[over=true]:bg-accent-soft aria-invalid:border-err"
        >
          {(open) => (
            <button
              type="button"
              onClick={open}
              className="flex items-center gap-2.5 py-1 text-left"
            >
              <Icon className="size-5 shrink-0 text-muted-foreground" />
              <span>
                <strong>Choose {chooseLabel}</strong>
                <span className="text-[12.5px] text-muted-foreground">
                  {" "}
                  or drop it here · {limitsText(input)}
                </span>
              </span>
            </button>
          )}
        </FilePicker>
      ) : (
        <div className="flex min-w-0 flex-col gap-2 rounded-xl border border-border bg-card px-2.5 py-2">
          <div className="flex min-w-0 items-center gap-2">
            <UploadThumb
              kind={kind}
              file={
                upload.status === "uploading" ? (upload.file ?? null) : null
              }
              upload={upload}
            />
            <div className="flex min-w-0 grow flex-col gap-0.5">
              <span className="truncate" title={upload.name}>
                {upload.name}
              </span>
              <UploadStatus upload={upload} />
            </div>
            <FilePicker
              id={input.id}
              accept={accept}
              describedBy={describedBy}
              onPick={(file) => onPick(file, needsPlayableVideo)}
              className="contents"
            >
              {(open) => (
                <Button type="button" variant="ghost" size="sm" onClick={open}>
                  Replace
                </Button>
              )}
            </FilePicker>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={`Remove ${input.label}`}
              onClick={onClear}
            >
              <X className="size-3.5" />
            </Button>
          </div>
          {canTrim && trimRange && mediaInput && (
            <Trimmer
              kind={kind === "video" ? "video" : "audio"}
              src={`/api/uploads/${upload.uploadId}`}
              durationMs={upload.durationMs as number}
              range={trimRange}
              onChange={onTrimRangeChange}
              minMs={mediaInput.minDurationMs}
              maxMs={mediaInput.maxDurationMs}
            />
          )}
        </div>
      )}
    </Field>
  );
}
