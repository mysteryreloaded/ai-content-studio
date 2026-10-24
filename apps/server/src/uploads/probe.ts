// Probes an Upload with ffprobe and makes its thumbnail with ffmpeg
// (issue #50), both already in the server image for Backend media. Only
// PNG, JPEG and WebP stills are accepted here; the extension comes from
// the probe, never from the file's own name.

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
const ACCEPTED_STILLS: Record<
  string,
  { format: string; extension: string; contentType: string }
> = {
  png: { format: "png_pipe", extension: "png", contentType: "image/png" },
  mjpeg: { format: "jpeg_pipe", extension: "jpg", contentType: "image/jpeg" },
  webp: { format: "webp_pipe", extension: "webp", contentType: "image/webp" },
};

const WRONG_KIND = "isn't a PNG, JPEG or WebP image";

async function run(
  command: string[],
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(command, { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { exitCode, stdout, stderr };
}

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

export async function probeImage(filePath: string): Promise<ProbeResult> {
  const { exitCode, stdout } = await run([
    "ffprobe",
    "-v",
    "error",
    "-print_format",
    "json",
    "-show_streams",
    "-show_format",
    filePath,
  ]);
  if (exitCode !== 0) return { ok: false, reason: WRONG_KIND };

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

/** Writes a WebP thumbnail of `inputPath`, its long side at most 160 px, to `outputPath`. */
export async function makeThumbnail(
  inputPath: string,
  outputPath: string,
): Promise<void> {
  const { exitCode, stderr } = await run([
    "ffmpeg",
    "-v",
    "error",
    "-y",
    "-i",
    inputPath,
    "-vf",
    "scale=160:160:force_original_aspect_ratio=decrease",
    "-frames:v",
    "1",
    "-c:v",
    "libwebp",
    "-f",
    "webp",
    outputPath,
  ]);
  if (exitCode !== 0) {
    throw new Error(`ffmpeg thumbnail failed: ${stderr.trim()}`);
  }
}
