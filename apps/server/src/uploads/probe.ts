// Pure parsing of ffprobe's JSON output for an Upload still, video or
// audio clip (issues #50, #51). A still's extension comes from the probe,
// never the file's own name; a video/audio's container is checked
// against the file's own extension (ffprobe's `format_name` can't tell
// MP4 from MOV, or WebM from MKV, on its own), so a misnamed file is
// refused instead of accepted under the wrong extension. Actually running
// ffprobe/ffmpeg goes through `MediaRunner` (media/media.ts), which
// bounds concurrency and wall-clock time, so a hostile or huge file can't
// hang `/complete` forever or starve the box Postgres shares.

/** The probe facts kept on an accepted image Upload. */
export interface ImageProbeFacts {
  formatName: string;
  codecName: string;
  width: number;
  height: number;
  pixFmt: string | null;
}

/** The probe facts kept on an accepted video Upload (issue #51). */
export interface VideoProbeFacts {
  formatName: string;
  codecName: string;
  audioCodecName: string | null;
  width: number;
  height: number;
  durationMs: number;
  fps: number;
  pixFmt: string | null;
  /**
   * False when ffprobe reports a variable frame rate or a container/codec
   * combo this studio doesn't trust a browser's `<video>` to play
   * reliably (ADR 0007): only an Upload the browser can play is ever
   * trimmed on a local player.
   */
  browserPlayable: boolean;
}

/** The probe facts kept on an accepted audio Upload (issue #51). */
export interface AudioProbeFacts {
  formatName: string;
  codecName: string;
  durationMs: number;
}

export type ProbeResult =
  | {
      ok: true;
      kind: "image";
      extension: string;
      contentType: string;
      facts: ImageProbeFacts;
    }
  | {
      ok: true;
      kind: "video";
      extension: string;
      contentType: string;
      facts: VideoProbeFacts;
    }
  | {
      ok: true;
      kind: "audio";
      extension: string;
      contentType: string;
      facts: AudioProbeFacts;
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
    r_frame_rate?: string;
    avg_frame_rate?: string;
  }>;
  format?: { format_name?: string; duration?: string };
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

/** Accepted video codecs (issue #51's AC): H.264, HEVC, VP8, VP9, AV1. */
const ACCEPTED_VIDEO_CODECS = new Set(["h264", "hevc", "vp8", "vp9", "av1"]);

/** Accepted audio codecs (issue #51's AC), one family per container. */
const ACCEPTED_AUDIO_CODECS: Record<string, ReadonlySet<string>> = {
  wav: new Set(["pcm_s16le", "pcm_s24le", "pcm_s32le", "pcm_u8", "pcm_f32le"]),
  mp3: new Set(["mp3"]),
  flac: new Set(["flac"]),
  ogg: new Set(["opus", "vorbis"]),
  opus: new Set(["opus"]),
  m4a: new Set(["aac"]),
  aac: new Set(["aac"]),
};

/** A video/audio container "family", by extension (issue #51): ffprobe's `format_name` can't tell MP4 apart from MOV, or WebM from MKV. */
const VIDEO_CONTAINER_FAMILY: Record<string, "isobmff" | "ebml"> = {
  mp4: "isobmff",
  mov: "isobmff",
  webm: "ebml",
  mkv: "ebml",
};

const AUDIO_CONTAINER_TOKEN: Record<string, string> = {
  wav: "wav",
  mp3: "mp3",
  flac: "flac",
  ogg: "ogg",
  opus: "ogg",
  m4a: "mp4",
  aac: "aac",
};

const VIDEO_MIME_TYPES: Record<string, string> = {
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  mkv: "video/x-matroska",
};

const AUDIO_MIME_TYPES: Record<string, string> = {
  wav: "audio/wav",
  mp3: "audio/mpeg",
  flac: "audio/flac",
  ogg: "audio/ogg",
  opus: "audio/opus",
  m4a: "audio/mp4",
  aac: "audio/aac",
};

export const WRONG_VIDEO_KIND =
  "isn't an MP4, MOV, WebM or MKV video with H.264, HEVC, VP8, VP9 or AV1";
export const WRONG_AUDIO_KIND =
  "isn't a WAV, MP3, FLAC, OGG/Opus or M4A/AAC audio clip";

function formatTokens(formatName: string): string[] {
  return formatName.split(",");
}

function parseFrameRate(value: string | undefined): number {
  if (!value) return 0;
  const [num, den] = value.split("/").map(Number);
  if (!num || !den) return 0;
  return num / den;
}

/**
 * Parses ffprobe's JSON for a video Upload (issue #51): exactly one video
 * stream in an accepted codec, its container matching `extension`'s own
 * family (so a misnamed file is refused). `browserPlayable` is false for
 * a variable frame rate or a combo this studio doesn't trust a browser's
 * `<video>` to play (ADR 0007).
 */
export function parseVideoProbeOutput(
  stdout: string,
  extension: string,
): ProbeResult {
  const family = VIDEO_CONTAINER_FAMILY[extension.toLowerCase()];
  if (!family) return { ok: false, reason: WRONG_VIDEO_KIND };

  let parsed: FfprobeOutput;
  try {
    parsed = JSON.parse(stdout) as FfprobeOutput;
  } catch {
    return { ok: false, reason: WRONG_VIDEO_KIND };
  }

  const streams = parsed.streams ?? [];
  const videoStreams = streams.filter((s) => s.codec_type === "video");
  const audioStream = streams.find((s) => s.codec_type === "audio");
  const stream = videoStreams[0];
  const formatName = parsed.format?.format_name ?? "";
  const tokens = formatTokens(formatName);
  const containerMatches =
    family === "isobmff"
      ? tokens.includes("mp4")
      : tokens.includes("matroska") || tokens.includes("webm");

  if (
    videoStreams.length !== 1 ||
    !stream?.codec_name ||
    !ACCEPTED_VIDEO_CODECS.has(stream.codec_name) ||
    !containerMatches ||
    typeof stream.width !== "number" ||
    typeof stream.height !== "number" ||
    stream.width < 1 ||
    stream.height < 1
  ) {
    return { ok: false, reason: WRONG_VIDEO_KIND };
  }

  const durationSeconds = Number(parsed.format?.duration ?? "0");
  if (!(durationSeconds > 0)) return { ok: false, reason: WRONG_VIDEO_KIND };

  const rFps = parseFrameRate(stream.r_frame_rate);
  const avgFps = parseFrameRate(stream.avg_frame_rate);
  const fps = avgFps || rFps;
  const isVfr = rFps > 0 && avgFps > 0 && Math.abs(rFps - avgFps) / rFps > 0.01;

  const reliablyPlayableCombo =
    (extension.toLowerCase() === "mp4" && stream.codec_name === "h264") ||
    (extension.toLowerCase() === "webm" &&
      (stream.codec_name === "vp8" || stream.codec_name === "vp9"));

  return {
    ok: true,
    kind: "video",
    extension: extension.toLowerCase(),
    contentType: VIDEO_MIME_TYPES[extension.toLowerCase()] ?? "video/mp4",
    facts: {
      formatName,
      codecName: stream.codec_name,
      audioCodecName: audioStream?.codec_name ?? null,
      width: stream.width,
      height: stream.height,
      durationMs: Math.round(durationSeconds * 1000),
      fps,
      pixFmt: stream.pix_fmt ?? null,
      browserPlayable: reliablyPlayableCombo && !isVfr,
    },
  };
}

/**
 * Parses ffprobe's JSON for an audio Upload (issue #51): exactly one
 * audio stream and no video stream, its codec and container matching
 * `extension`'s own expected pair (so a misnamed file is refused).
 */
export function parseAudioProbeOutput(
  stdout: string,
  extension: string,
): ProbeResult {
  const lowerExtension = extension.toLowerCase();
  const acceptedCodecs = ACCEPTED_AUDIO_CODECS[lowerExtension];
  const expectedToken = AUDIO_CONTAINER_TOKEN[lowerExtension];
  if (!acceptedCodecs || !expectedToken) {
    return { ok: false, reason: WRONG_AUDIO_KIND };
  }

  let parsed: FfprobeOutput;
  try {
    parsed = JSON.parse(stdout) as FfprobeOutput;
  } catch {
    return { ok: false, reason: WRONG_AUDIO_KIND };
  }

  const streams = parsed.streams ?? [];
  const audioStreams = streams.filter((s) => s.codec_type === "audio");
  const videoStreams = streams.filter((s) => s.codec_type === "video");
  const stream = audioStreams[0];
  const formatName = parsed.format?.format_name ?? "";
  const containerMatches = formatTokens(formatName).includes(expectedToken);

  if (
    audioStreams.length !== 1 ||
    videoStreams.length !== 0 ||
    !stream?.codec_name ||
    !acceptedCodecs.has(stream.codec_name) ||
    !containerMatches
  ) {
    return { ok: false, reason: WRONG_AUDIO_KIND };
  }

  const durationSeconds = Number(parsed.format?.duration ?? "0");
  if (!(durationSeconds > 0)) return { ok: false, reason: WRONG_AUDIO_KIND };

  return {
    ok: true,
    kind: "audio",
    extension: lowerExtension,
    contentType: AUDIO_MIME_TYPES[lowerExtension] ?? "audio/mpeg",
    facts: {
      formatName,
      codecName: stream.codec_name,
      durationMs: Math.round(durationSeconds * 1000),
    },
  };
}
