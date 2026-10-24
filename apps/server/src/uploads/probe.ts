// Pure parsing of ffprobe's JSON output for an Upload still (issue #50).
// Only PNG, JPEG and WebP are accepted; the extension comes from the
// probe, never the file's own name. Actually running ffprobe/ffmpeg goes
// through `MediaRunner` (media/media.ts), which bounds concurrency and
// wall-clock time, so a hostile or huge file can't hang `/complete`
// forever or starve the box Postgres shares.

/** The probe facts kept on an accepted image Upload. */
export interface ImageProbeFacts {
  formatName: string;
  codecName: string;
  width: number;
  height: number;
  pixFmt: string | null;
}

export type ProbeResult =
  | {
      ok: true;
      kind: "image";
      extension: string;
      contentType: string;
      facts: ImageProbeFacts;
    }
  | { ok: false; reason: string };

/** ffprobe's own (format, codec) pair for each accepted still. */
export const ACCEPTED_STILLS: Record<
  string,
  { format: string; extension: string; contentType: string }
> = {
  png: { format: "png_pipe", extension: "png", contentType: "image/png" },
  mjpeg: { format: "jpeg_pipe", extension: "jpg", contentType: "image/jpeg" },
  webp: { format: "webp_pipe", extension: "webp", contentType: "image/webp" },
};

export const WRONG_KIND = "isn't a PNG, JPEG or WebP image";

/** `makeThumbnail` decodes the whole frame to scale it; above this, refuse before it does (issue #50). */
export const MAX_IMAGE_MEGAPIXELS = 100_000_000;

interface FfprobeOutput {
  streams?: Array<{
    codec_type?: string;
    codec_name?: string;
    width?: number;
    height?: number;
    pix_fmt?: string;
  }>;
  format?: { format_name?: string };
}

/** Parses ffprobe's `-show_streams -show_format` JSON for an accepted still, or says why not. */
export function parseProbeOutput(stdout: string): ProbeResult {
  let parsed: FfprobeOutput;
  try {
    parsed = JSON.parse(stdout) as FfprobeOutput;
  } catch {
    return { ok: false, reason: WRONG_KIND };
  }

  const streams = parsed.streams ?? [];
  const stream = streams[0];
  const formatName = parsed.format?.format_name ?? "";
  const accepted = stream?.codec_name
    ? ACCEPTED_STILLS[stream.codec_name]
    : undefined;
  if (
    streams.length !== 1 ||
    stream?.codec_type !== "video" ||
    !accepted ||
    accepted.format !== formatName ||
    typeof stream.width !== "number" ||
    typeof stream.height !== "number" ||
    stream.width < 1 ||
    stream.height < 1
  ) {
    return { ok: false, reason: WRONG_KIND };
  }

  return {
    ok: true,
    kind: "image",
    extension: accepted.extension,
    contentType: accepted.contentType,
    facts: {
      formatName,
      codecName: stream.codec_name as string,
      width: stream.width,
      height: stream.height,
      pixFmt: stream.pix_fmt ?? null,
    },
  };
}
