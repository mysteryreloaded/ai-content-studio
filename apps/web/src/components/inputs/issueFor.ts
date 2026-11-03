import {
  pickAudioIssue,
  pickIssue,
  pickVideoIssue,
  readMediaDuration,
} from "../../lib/chunkedUpload.js";
import type { ImageUploadInput, MediaUploadInput } from "./types.js";

/** A picked image's size, when this browser can decode it; null otherwise (the server checks again at complete). */
async function readDimensions(
  file: File,
): Promise<{ width: number; height: number } | null> {
  if (typeof createImageBitmap !== "function") return null;
  try {
    const bitmap = await createImageBitmap(file);
    const dimensions = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return dimensions;
  } catch {
    return null;
  }
}

/** A pick-time refusal (issues #50, #51, #197): `prefixed` ones are shown as `${file.name} ${message}.`; the rest (the unplayable-video message, which names no file) stand alone. */
export interface PickIssue {
  message: string;
  prefixed: boolean;
}

/**
 * The browser's own issue with `file` for `input`'s kind, before any byte
 * is sent (issues #50, #51). `needsPlayableVideo` (issue #197) is true
 * when a video Input is trimmable or feeds a Points Input: both need a
 * local player to pick a trim or a frame, so a video this browser can't
 * read any metadata from at all (no duration, no dimensions) is refused
 * here rather than accepted untrimmed with no way to trim or pick points.
 */
export async function issueFor(
  input: ImageUploadInput | MediaUploadInput,
  file: File,
  maxUploadMb: number | null,
  needsPlayableVideo = false,
): Promise<PickIssue | null> {
  if (input.kind === "image_upload") {
    const message = await pickIssue(
      file,
      input,
      maxUploadMb,
      await readDimensions(file),
    );
    return message ? { message, prefixed: true } : null;
  }
  if (input.kind === "video_upload") {
    const facts = await readMediaDuration(file, "video");
    if (facts === null && needsPlayableVideo) {
      return {
        message:
          "This video can't be shown in your browser. Convert it to H.264 MP4 or try another browser.",
        prefixed: false,
      };
    }
    const message = pickVideoIssue(
      file,
      input,
      maxUploadMb,
      facts ?? undefined,
    );
    return message ? { message, prefixed: true } : null;
  }
  const facts = await readMediaDuration(file, "audio");
  const message = pickAudioIssue(
    file,
    input,
    maxUploadMb,
    facts?.durationMs ?? null,
  );
  return message ? { message, prefixed: true } : null;
}
