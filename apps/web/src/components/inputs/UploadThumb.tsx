import { cn } from "cn";
import { AudioLines, Image, Video } from "lucide-react";
import { useEffect, useState } from "react";
import type { UploadState } from "./types.js";

/**
 * An Upload's thumbnail (issue #197): the server's own WebP thumbnail
 * once complete, a local object URL while an image is still uploading,
 * and an icon tile for audio or when the thumbnail 404s. 52 px here;
 * issue #195 reuses it at 22 px for a Submission's used Uploads.
 */
export function UploadThumb({
  kind,
  file,
  upload,
  size = 52,
  className,
}: {
  kind: "image" | "video" | "audio";
  file: File | null;
  upload: UploadState | undefined;
  size?: number;
  className?: string;
}) {
  const [broken, setBroken] = useState(false);
  const [localUrl, setLocalUrl] = useState<string | null>(null);

  useEffect(() => {
    if (kind !== "image" || upload?.status !== "uploading" || !file) {
      setLocalUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setLocalUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [kind, upload?.status, file]);

  const dimension = { width: size, height: size };
  const Icon = kind === "video" ? Video : kind === "audio" ? AudioLines : Image;

  if (kind === "audio" || broken || upload?.status !== "complete") {
    if (kind === "image" && localUrl) {
      return (
        <img
          src={localUrl}
          alt=""
          style={dimension}
          className={cn(
            "shrink-0 rounded-[5px] bg-media object-cover",
            className,
          )}
        />
      );
    }
    return (
      <div
        aria-hidden
        style={dimension}
        className={cn(
          "grid shrink-0 place-items-center rounded-[5px] bg-media text-media-foreground",
          className,
        )}
      >
        <Icon className="size-5" />
      </div>
    );
  }

  return (
    <img
      src={`/api/uploads/${upload.uploadId}/thumb`}
      alt=""
      style={dimension}
      className={cn("shrink-0 rounded-[5px] bg-media object-cover", className)}
      onError={() => setBroken(true)}
    />
  );
}
