// A downloaded Asset's file name (issue #45's AC):
// `<model-slug>-<mode-slug>-<last 8 of Generation id>.<ext>`, then `-2`,
// `-3`, ... for Assets of the same Generation that would otherwise share
// that name (same file extension, e.g. two SaveImage outputs in one
// Mode).

import { slugify } from "../models/validation.js";

function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot === -1 ? "bin" : filename.slice(dot + 1).toLowerCase();
}

export interface DownloadNameInput {
  id: string;
  sortOrder: number;
  comfyuiFilename: string;
}

/** The download file name for `asset`, among its own Generation's other `siblings` (including itself). */
export function downloadFileName(
  modelSlug: string,
  modeName: string,
  generationId: string,
  asset: DownloadNameInput,
  siblings: readonly DownloadNameInput[],
): string {
  const ext = extensionOf(asset.comfyuiFilename);
  const base = `${modelSlug}-${slugify(modeName)}-${generationId.slice(-8)}`;

  const sameExt = [...siblings]
    .filter((sibling) => extensionOf(sibling.comfyuiFilename) === ext)
    .sort(
      (a, b) =>
        a.sortOrder - b.sortOrder ||
        a.comfyuiFilename.localeCompare(b.comfyuiFilename),
    );
  const position = sameExt.findIndex(
    (sibling) =>
      sibling.sortOrder === asset.sortOrder &&
      sibling.comfyuiFilename === asset.comfyuiFilename,
  );

  return position <= 0 ? `${base}.${ext}` : `${base}-${position + 1}.${ext}`;
}
