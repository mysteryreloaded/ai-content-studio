import type { UploadState } from "./types.js";

/** `1.2 MB`/`840 KB` the way the prototype's `mb()` reads a byte count. */
function formatSize(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(mb >= 10 ? 0 : 1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** `0:12.3`/`1:02.3` the way the prototype's `secs()` reads a duration. */
function formatDuration(ms: number): string {
  const total = ms / 1000;
  const minutes = Math.floor(total / 60);
  const seconds = total - minutes * 60;
  return `${minutes}:${seconds.toFixed(1).padStart(4, "0")}`;
}

/** An Upload's status line (issue #197): progress while uploading, then size/resolution/duration once complete. */
export function UploadStatus({ upload }: { upload: UploadState }) {
  if (upload.status === "uploading") {
    const pct = Math.floor(upload.progress * 100);
    return (
      <div className="flex flex-col gap-1">
        <div
          role="progressbar"
          tabIndex={-1}
          aria-label={`Uploading ${upload.name}`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          className="h-1.5 overflow-hidden rounded-[3px] bg-muted"
        >
          <div
            className="h-full bg-primary transition-[width] duration-400"
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="text-[12.5px] tabular-nums text-muted-foreground">
          Uploading {pct}%
        </span>
      </div>
    );
  }
  if (upload.status === "error") return null;

  const parts = [
    upload.size !== undefined ? formatSize(upload.size) : null,
    upload.width && upload.height ? `${upload.width}×${upload.height}` : null,
    upload.durationMs !== null ? formatDuration(upload.durationMs) : null,
  ].filter((part): part is string => part !== null);

  return (
    <span className="text-[12.5px] tabular-nums text-muted-foreground">
      {parts.join(" · ")}
      {upload.browserPlayable === false &&
        " · can't preview here; used untrimmed"}
    </span>
  );
}
