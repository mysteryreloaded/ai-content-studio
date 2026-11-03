import { AudioLines } from "lucide-react";
import { type CSSProperties, useState } from "react";
import type { AssetSummary } from "./types.js";

export function assetSrc(asset: AssetSummary): string {
  return `/api/assets/${asset.id}`;
}

/** A tall card caps at 300px, a square one at 420px (issue #195); a wide one is left to the aspect-ratio box. */
function mediaBoxStyle(ratio: number | null): CSSProperties {
  const r = ratio ?? 16 / 9;
  const style: CSSProperties = { aspectRatio: `${r}` };
  if (r < 0.9) style.maxHeight = 300;
  else if (r <= 1.15) style.maxHeight = 420;
  return style;
}

/** Plays the main (first) Asset in place once the Generation has succeeded, seekable, sized from the Asset's own `width`/`height` (falling back to the loaded media's own dimensions, and to 16/9 until either is known). */
export function AssetPlayer({ asset }: { asset: AssetSummary }) {
  const [ratio, setRatio] = useState<number | null>(
    asset.width && asset.height ? asset.width / asset.height : null,
  );

  if (asset.kind === "video") {
    return (
      <div
        className="gen-media relative w-full overflow-hidden bg-media"
        style={mediaBoxStyle(ratio)}
      >
        {/* biome-ignore lint/a11y/useMediaCaption: a generated Asset has no captions to offer. */}
        <video
          controls
          playsInline
          preload="metadata"
          loop
          poster={`/api/assets/${asset.id}/poster`}
          src={assetSrc(asset)}
          className="block size-full object-contain bg-media"
          onLoadedMetadata={(event) => {
            if (ratio !== null) return;
            const video = event.currentTarget;
            if (video.videoWidth && video.videoHeight) {
              setRatio(video.videoWidth / video.videoHeight);
            }
          }}
        />
      </div>
    );
  }

  if (asset.kind === "audio") {
    return (
      <div className="gen-media relative flex w-full flex-col items-center justify-center gap-2 bg-media p-4 text-media-foreground aspect-video">
        <AudioLines className="size-8" />
        {/* biome-ignore lint/a11y/useMediaCaption: a generated Asset has no captions to offer. */}
        <audio controls src={assetSrc(asset)} className="w-full" />
      </div>
    );
  }

  return (
    <div
      className="gen-media relative w-full overflow-hidden bg-media"
      style={mediaBoxStyle(ratio)}
    >
      <img
        src={assetSrc(asset)}
        alt=""
        className="block size-full object-contain bg-media"
        onLoad={(event) => {
          if (ratio !== null) return;
          const img = event.currentTarget;
          if (img.naturalWidth && img.naturalHeight) {
            setRatio(img.naturalWidth / img.naturalHeight);
          }
        }}
      />
    </div>
  );
}
