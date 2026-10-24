// Signs a finished Asset's file with a C2PA manifest via `c2patool`
// (issue #75), via a temp file and rename, mirroring finish.ts's own
// ffmpeg temp-file dance. Best-effort like the rest of Asset finishing:
// a signing failure or an unsupported format/arch falls back to the
// Asset keeping only its existing "AI-generated" tag (video's comment
// tag from issue #45) rather than failing the Generation.

import { rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

/** c2patool has no arm64 Linux build (see the Dockerfile's `c2patool` stage): signing is skipped there. */
export function c2paSupportsArch(arch: string = process.arch): boolean {
  return arch !== "arm64";
}

/**
 * Formats c2patool (and the Rust library behind it) can read and write,
 * restricted to the ones AI Content Studio's Save nodes actually
 * produce (`SAVE_NODE_KINDS` in packages/shared). Notably excludes
 * `webm` (`SaveWEBM`) and `ogg`/`opus` (`SaveAudioOpus`), which c2patool
 * doesn't support.
 */
const SUPPORTED_EXTENSIONS: ReadonlySet<string> = new Set([
  ".mp4",
  ".mov",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".wav",
  ".mp3",
  ".flac",
  ".m4a",
]);

export function c2paSupportsFormat(filename: string): boolean {
  return SUPPORTED_EXTENSIONS.has(path.extname(filename).toLowerCase());
}

export interface C2paSignerConfig {
  certPath: string;
  keyPath: string;
  timestampUrl?: string;
}

export interface C2paManifestInfo {
  modelName: string;
  siteTitle: string;
  generationId: string;
}

/**
 * The IPTC digital source type for generative-AI content (issue #75's
 * AC): https://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia
 */
const TRAINED_ALGORITHMIC_MEDIA =
  "http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia";

/** The custom assertion's label, namespaced to this app (c2patool allows any dotted label). */
const GENERATION_ASSERTION_LABEL = "studio.ai-content-studio.generation";

/** c2patool's manifest definition JSON (issue #75's AC): `c2pa.created` + `trainedAlgorithmicMedia`, the Model, the site title and the Generation id. */
export function buildManifest(
  signer: C2paSignerConfig,
  info: C2paManifestInfo,
): Record<string, unknown> {
  return {
    title: info.siteTitle,
    sign_cert: signer.certPath,
    private_key: signer.keyPath,
    ...(signer.timestampUrl ? { ta_url: signer.timestampUrl } : {}),
    assertions: [
      {
        label: "c2pa.actions",
        data: {
          actions: [
            {
              action: "c2pa.created",
              digitalSourceType: TRAINED_ALGORITHMIC_MEDIA,
            },
          ],
        },
      },
      {
        label: GENERATION_ASSERTION_LABEL,
        data: {
          model: info.modelName,
          site: info.siteTitle,
          generationId: info.generationId,
        },
      },
    ],
  };
}

export interface C2paToolRunner {
  signC2pa(
    assetPath: string,
    manifestPath: string,
    outputPath: string,
  ): Promise<void>;
}

/**
 * Signs `absPath` in place: writes the manifest beside it, runs
 * c2patool to a `.c2pa-signing-` temp file, then renames it over
 * `absPath` (same temp-file-and-rename shape as finishVideo's remux).
 * Swallows a signing failure into `onWarning` rather than throwing —
 * the Asset keeps its pre-signing bytes and its existing tag.
 */
export async function signAssetWithC2pa(
  tool: C2paToolRunner,
  absPath: string,
  signer: C2paSignerConfig,
  info: C2paManifestInfo,
  onWarning: (message: string) => void,
): Promise<void> {
  const ext = path.extname(absPath);
  const id = crypto.randomUUID();
  const manifestPath = `${absPath.slice(0, -ext.length)}.c2pa-manifest-${id}.json`;
  const signedPath = `${absPath.slice(0, -ext.length)}.c2pa-signing-${id}${ext}`;

  try {
    await writeFile(manifestPath, JSON.stringify(buildManifest(signer, info)));
    try {
      await tool.signC2pa(absPath, manifestPath, signedPath);
    } catch (err) {
      await rm(signedPath, { force: true });
      throw err;
    }
    await rename(signedPath, absPath);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    onWarning(`C2PA signing failed: ${message}`);
  } finally {
    await rm(manifestPath, { force: true });
  }
}
