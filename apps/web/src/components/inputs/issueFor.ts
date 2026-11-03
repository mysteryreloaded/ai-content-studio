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

/** The browser's own issue with `file` for `input`'s kind, before any byte is sent (issues #50, #51). */
export async function issueFor(
  input: ImageUploadInput | MediaUploadInput,
  file: File,
  maxUploadMb: number | null,
): Promise<string | null> {
  if (input.kind === "image_upload") {
    return pickIssue(file, input, maxUploadMb, await readDimensions(file));
  }
  if (input.kind === "video_upload") {
    const facts = await readMediaDuration(file, "video");
    return pickVideoIssue(file, input, maxUploadMb, facts ?? undefined);
  }
  const facts = await readMediaDuration(file, "audio");
  return pickAudioIssue(file, input, maxUploadMb, facts?.durationMs ?? null);
}
