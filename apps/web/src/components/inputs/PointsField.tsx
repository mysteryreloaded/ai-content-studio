import {
  centerCropRegion,
  decodePointsValue,
  dropPointsOutsideCrop,
  encodePointsValue,
  isPointInCrop,
} from "@ai-content-studio/shared";
import { cn } from "cn";
import { Crosshair, Info, Loader2, TriangleAlert } from "lucide-react";
import {
  type MouseEvent as ReactMouseEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Button } from "../ui/button.js";
import { Field, fieldDescribedBy } from "./Field.js";
import { formatClock } from "./Trimmer.js";
import type { PointsFieldProps, VideoUploadInput } from "./types.js";

/**
 * A Points Input's crop/scale target Width or Height (issue #52 CEO
 * review round 2 point 4): when `inputId` names a shown Select Input,
 * its current (or default) value is an option id, resolved through
 * `optionValues`, not a number `Number()` can parse; a Number Input's
 * own value parses directly. Falls back to the literal `fallback` when
 * nothing resolves (no bound Input, or its value is blank).
 */
function resolveTargetSize(
  inputId: string | null,
  optionValues: Record<string, number> | null,
  fallback: number | null,
  values: Record<string, string>,
): number | null {
  if (!inputId) return fallback;
  const raw = values[inputId];
  if (!raw) return fallback;
  if (optionValues) {
    return optionValues[raw] ?? fallback;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Closest distance (as a fraction of the frame) at which a click counts as "on an existing point", rather than a new one. */
const POINT_HIT_RADIUS = 0.03;

type Note = { kind: "warn" | "info"; text: string };

/**
 * One Points Input (issue #52, restyled for issue #197): click the
 * first frame of the trimmed video, inside the dashed crop outline, to
 * pick 1-10 numbered points.
 */
export function PointsField({
  input,
  allInputs,
  uploads,
  trimRangeByInputId,
  values,
  onPointsChange,
  issue,
}: PointsFieldProps) {
  const videoInput = allInputs.find(
    (candidate): candidate is VideoUploadInput =>
      candidate.id === input.videoInputId && candidate.kind === "video_upload",
  );
  const upload = videoInput ? uploads[videoInput.id] : undefined;
  const range = videoInput ? trimRangeByInputId[videoInput.id] : undefined;
  const uploadId = upload?.status === "complete" ? upload.uploadId : null;
  const startMs = range?.startMs ?? null;

  const targetWidth = resolveTargetSize(
    input.widthInputId,
    input.widthOptionValues,
    input.defaultWidth,
    values,
  );
  const targetHeight = resolveTargetSize(
    input.heightInputId,
    input.heightOptionValues,
    input.defaultHeight,
    values,
  );

  const videoRef = useRef<HTMLVideoElement>(null);
  const [frame, setFrame] = useState<{ width: number; height: number } | null>(
    null,
  );
  const [note, setNote] = useState<Note | null>(null);
  const rawPoints = values[input.id] ?? "";
  // Memoized so it's referentially stable across renders the stored
  // value itself doesn't change, keeping the effects below from
  // re-running on every unrelated render.
  const points = useMemo(() => decodePointsValue(rawPoints) ?? [], [rawPoints]);

  // Issue #52 AC: a new video or a moved trim start clears the points,
  // each with its own note (issue #197's AC). `undefined` means "first
  // render": the value already carried forward (e.g. a 409 reload) must
  // survive it.
  const prevRef = useRef<{ uploadId: string; startMs: number } | undefined>(
    undefined,
  );
  useEffect(() => {
    if (uploadId === null || startMs === null) {
      prevRef.current = undefined;
      return;
    }
    const prev = prevRef.current;
    prevRef.current = { uploadId, startMs };
    if (!prev) return;
    const videoChanged = prev.uploadId !== uploadId;
    const startMoved = !videoChanged && prev.startMs !== startMs;
    if (!videoChanged && !startMoved) return;
    setFrame(null);
    if (points.length > 0) {
      onPointsChange(input.id, "");
      setNote({
        kind: "info",
        text: videoChanged
          ? "Points cleared: the video changed."
          : "Points cleared: the trim start moved, so the first frame changed.",
      });
    }
  }, [uploadId, startMs, input.id, onPointsChange, points.length]);

  // Reads the picked frame's own pixel size once the player can show it.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || uploadId === null || startMs === null) return;
    const apply = () => {
      setFrame({ width: video.videoWidth, height: video.videoHeight });
      try {
        video.currentTime = startMs / 1000;
      } catch {
        // Some browsers refuse to seek before the first frame paints; a
        // later `loadeddata` isn't needed here, only the frame's size.
      }
    };
    if (video.readyState >= 1) apply();
    video.addEventListener("loadedmetadata", apply);
    return () => video.removeEventListener("loadedmetadata", apply);
  }, [uploadId, startMs]);

  const crop =
    frame && targetWidth && targetHeight
      ? centerCropRegion(frame.width, frame.height, targetWidth, targetHeight)
      : null;

  // Issue #52 AC: a new size drops out-of-crop points, with a note.
  const cropKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!frame || !targetWidth || !targetHeight) return;
    const key = `${frame.width}x${frame.height}:${targetWidth}x${targetHeight}`;
    const isFirstRun = cropKeyRef.current === null;
    cropKeyRef.current = key;
    if (isFirstRun) return;
    const kept = dropPointsOutsideCrop(
      points,
      frame.width,
      frame.height,
      targetWidth,
      targetHeight,
    );
    const dropped = points.length - kept.length;
    if (dropped > 0) {
      onPointsChange(input.id, kept.length > 0 ? encodePointsValue(kept) : "");
      setNote({
        kind: "info",
        text: `${dropped} point${dropped === 1 ? "" : "s"} fell outside the new size and ${dropped === 1 ? "was" : "were"} removed.`,
      });
    }
  }, [frame, targetWidth, targetHeight, points, input.id, onPointsChange]);

  function removePoint(index: number) {
    const next = points.filter((_, i) => i !== index);
    onPointsChange(input.id, next.length > 0 ? encodePointsValue(next) : "");
    setNote(null);
  }

  function clearAll() {
    onPointsChange(input.id, "");
    setNote(null);
  }

  function handleFrameClick(event: ReactMouseEvent<HTMLDivElement>) {
    if (!frame || !crop) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;

    const hitIndex = points.findIndex(
      (point) => Math.hypot(point.x - x, point.y - y) < POINT_HIT_RADIUS,
    );
    if (hitIndex >= 0) {
      removePoint(hitIndex);
      return;
    }
    if (!isPointInCrop({ x, y }, frame.width, frame.height, crop)) {
      setNote({
        kind: "warn",
        text: "Click inside the outlined area: only that part of the video is kept.",
      });
      return;
    }
    if (points.length >= 10) {
      setNote({
        kind: "warn",
        text: "At most 10 points. Click a point to remove it.",
      });
      return;
    }
    onPointsChange(input.id, encodePointsValue([...points, { x, y }]));
    setNote(null);
  }

  const describedBy = fieldDescribedBy(input.id, input.help, issue);

  if (!videoInput) return null;

  const cropPct = crop
    ? {
        left: (crop.left / (frame?.width || 1)) * 100,
        top: (crop.top / (frame?.height || 1)) * 100,
        width: (crop.width / (frame?.width || 1)) * 100,
        height: (crop.height / (frame?.height || 1)) * 100,
      }
    : null;

  return (
    <Field
      id={input.id}
      label={input.label}
      optional={!input.required}
      help={input.help}
      error={issue}
    >
      {!uploadId || startMs === null ? (
        <div className="flex items-center gap-2 rounded-xl border-[1.5px] border-dashed border-input bg-muted p-3.5 text-[13px] text-muted-foreground">
          <Crosshair className="size-4.5 shrink-0" />
          Add the {videoInput.label.toLowerCase()} first; then click the person
          to replace on its first frame.
        </div>
      ) : upload?.status === "complete" && upload.browserPlayable === false ? (
        <div className="flex items-center gap-2 rounded-xl border-[1.5px] border-dashed border-input bg-muted p-3.5 text-[13px] text-muted-foreground">
          This video can't be shown in your browser, so you can't pick who to
          replace. Convert it to H.264 MP4 or try another browser.
        </div>
      ) : !targetWidth || !targetHeight ? (
        <div className="flex items-center gap-2 rounded-xl border-[1.5px] border-dashed border-input bg-muted p-3.5 text-[13px] text-muted-foreground">
          Set a size first.
        </div>
      ) : !frame ? (
        <div className="flex items-center gap-2 rounded-xl border-[1.5px] border-dashed border-input bg-muted p-3.5 text-[13px] text-muted-foreground">
          <Loader2 className="size-4.5 shrink-0 animate-spin" />
          Getting the first frame…
          {/* The DOM-only video the frame size is read from; see the effect above. */}
          <video
            ref={videoRef}
            src={`/api/uploads/${uploadId}`}
            muted
            playsInline
            preload="metadata"
            className="sr-only"
          />
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {/* biome-ignore lint/a11y/useKeyWithClickEvents: pointer-only picking of a pixel position has no keyboard equivalent; the point list below, with its own Remove buttons, is the keyboard-accessible path. */}
          <div
            role="application"
            aria-label="First frame: click the person to replace"
            aria-describedby={describedBy}
            className="relative w-full max-w-[560px] cursor-crosshair overflow-hidden rounded-md bg-media"
            style={{ aspectRatio: `${frame.width} / ${frame.height}` }}
            onClick={handleFrameClick}
          >
            <video
              ref={videoRef}
              src={`/api/uploads/${uploadId}`}
              muted
              playsInline
              preload="metadata"
              className="absolute inset-0 h-full w-full object-cover"
            />
            {cropPct && (
              // biome-ignore lint/a11y/noSvgWithoutTitle: aria-hidden; the frame's own aria-label already describes it.
              <svg
                aria-hidden
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
                className="absolute inset-0 h-full w-full"
              >
                <path
                  fillRule="evenodd"
                  fill="rgb(0 0 0 / 0.55)"
                  d={`M0,0 H100 V100 H0 Z M${cropPct.left},${cropPct.top} H${
                    cropPct.left + cropPct.width
                  } V${cropPct.top + cropPct.height} H${cropPct.left} Z`}
                />
                <rect
                  x={cropPct.left}
                  y={cropPct.top}
                  width={cropPct.width}
                  height={cropPct.height}
                  fill="none"
                  stroke="white"
                  strokeWidth={0.6}
                  strokeDasharray="2 1.5"
                  vectorEffect="non-scaling-stroke"
                />
              </svg>
            )}
            {points.map((point, index) => (
              <span
                key={`${point.x}-${point.y}-${index}`}
                aria-hidden
                style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%` }}
                className="pointer-events-none absolute -mt-2.5 -ml-2.5 size-5 rounded-full bg-[#2bd97a] text-center text-[11px] leading-5 font-semibold text-[#06210f] shadow-[0_0_0_2px_#fff,0_2px_6px_rgb(0_0_0/0.5)]"
              >
                {index + 1}
              </span>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-1.5 text-[12.5px] text-muted-foreground">
            <span>
              {points.length > 0
                ? `${points.length} point${points.length === 1 ? "" : "s"}`
                : "No points yet"}{" "}
              · frame at {formatClock(startMs / 1000)}
            </span>
            {points.length > 0 && (
              <Button
                type="button"
                variant="ghost"
                size="xs"
                onClick={clearAll}
              >
                Clear
              </Button>
            )}
          </div>
          {points.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {points.map((point, index) => (
                <Button
                  key={`${point.x}-${point.y}-${index}`}
                  type="button"
                  variant="ghost"
                  size="xs"
                  aria-label={`Remove point ${index + 1}`}
                  onClick={() => removePoint(index)}
                >
                  Point {index + 1} ✕
                </Button>
              ))}
            </div>
          )}
        </div>
      )}
      {note && (
        <p
          role={note.kind === "warn" ? "alert" : "status"}
          className={cn(
            "flex items-start gap-1.5 text-sm",
            note.kind === "warn" ? "text-err" : "text-info",
          )}
        >
          {note.kind === "warn" ? (
            <TriangleAlert className="size-3.5 shrink-0 translate-y-px" />
          ) : (
            <Info className="size-3.5 shrink-0 translate-y-px" />
          )}
          {note.text}
        </p>
      )}
    </Field>
  );
}
