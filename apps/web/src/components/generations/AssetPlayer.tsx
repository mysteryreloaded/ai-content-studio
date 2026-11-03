import type { AssetSummary } from "./types.js";

export function assetSrc(asset: AssetSummary): string {
  return `/api/assets/${asset.id}`;
}

/** Plays the main (first) Asset in place once the Generation has succeeded. */
export function AssetPlayer({ asset }: { asset: AssetSummary }) {
  if (asset.kind === "video") {
    return (
      // biome-ignore lint/a11y/useMediaCaption: a generated Asset has no captions to offer.
      <video
        controls
        poster={`/api/assets/${asset.id}/poster`}
        src={assetSrc(asset)}
        className="workbench-asset"
      />
    );
  }
  if (asset.kind === "audio") {
    // biome-ignore lint/a11y/useMediaCaption: a generated Asset has no captions to offer.
    return <audio controls src={assetSrc(asset)} className="workbench-asset" />;
  }
  return <img src={assetSrc(asset)} alt="" className="workbench-asset" />;
}
