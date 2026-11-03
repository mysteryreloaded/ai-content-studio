import {
  centerCropRegion,
  decodePointsValue,
  dropPointsOutsideCrop,
  encodePointsValue,
  isPointInCrop,
} from "@ai-content-studio/shared";
import {
  type ElementType,
  Fragment,
  type MouseEvent as ReactMouseEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  PointsFieldProps,
  PointsPickersProps,
  VideoUploadInput,
} from "./types.js";

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

/** The Workbench's Points Inputs (issue #52): click the first frame of the trimmed video, inside the outlined crop, to pick 1-10 points. */
export function PointsPickers({
  inputs,
  allInputs,
  uploads,
  trimRangeByInputId,
  values,
  onPointsChange,
  issuesByInputId,
  bare = false,
}: PointsPickersProps) {
  if (inputs.length === 0) return null;
  const Wrapper: ElementType = bare ? Fragment : "fieldset";
  return (
    <Wrapper>
      {!bare && <legend>Points</legend>}
      {inputs.map((input) => (
        <PointsField
          key={input.id}
          input={input}
          allInputs={allInputs}
          uploads={uploads}
          trimRangeByInputId={trimRangeByInputId}
          values={values}
          onPointsChange={onPointsChange}
          issue={issuesByInputId[input.id]}
        />
      ))}
    </Wrapper>
  );
}

function PointsField({
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
  const [note, setNote] = useState<string | null>(null);
  const rawPoints = values[input.id] ?? "";
  // Memoized so it's referentially stable across renders the stored
  // value itself doesn't change, keeping the crop-change effect below
  // from re-running on every unrelated render.
  const points = useMemo(() => decodePointsValue(rawPoints) ?? [], [rawPoints]);

  // Issue #52 AC: a new video or trim start clears the points. `null`
  // means "first render": the value already carried forward (e.g. a
  // 409 reload) must survive it.
  const clearedKeyRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const key =
      uploadId !== null && startMs !== null ? `${uploadId}:${startMs}` : null;
    const isFirstRun = clearedKeyRef.current === undefined;
    const changed = clearedKeyRef.current !== key;
    clearedKeyRef.current = key;
    if (!isFirstRun && changed) {
      onPointsChange(input.id, "");
      setNote(null);
      setFrame(null);
    }
  }, [uploadId, startMs, input.id, onPointsChange]);

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
    if (kept.length !== points.length) {
      onPointsChange(input.id, kept.length > 0 ? encodePointsValue(kept) : "");
      setNote(
        `The new size dropped ${points.length - kept.length} point${
          points.length - kept.length === 1 ? "" : "s"
        } that fell outside the crop.`,
      );
    }
  }, [frame, targetWidth, targetHeight, points, input.id, onPointsChange]);

  function removePoint(index: number) {
    const next = points.filter((_, i) => i !== index);
    onPointsChange(input.id, next.length > 0 ? encodePointsValue(next) : "");
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
      setNote("That point is outside the crop.");
      return;
    }
    if (points.length >= 10) {
      setNote("Up to 10 points.");
      return;
    }
    onPointsChange(input.id, encodePointsValue([...points, { x, y }]));
    setNote(null);
  }

  const issueId = issue ? `input-issue-${input.id}` : undefined;

  if (!videoInput) return null;

  return (
    <div>
      <label htmlFor={`input-points-${input.id}`}>{input.label}</label>
      {input.help && <p>{input.help}</p>}
      {!uploadId || startMs === null ? (
        <p>Pick a video above first.</p>
      ) : upload?.status === "complete" && upload.browserPlayable === false ? (
        <p>This browser can't preview that video, so points can't be picked.</p>
      ) : !targetWidth || !targetHeight ? (
        <p>Set a size first.</p>
      ) : (
        <>
          {/* biome-ignore lint/a11y/useKeyWithClickEvents: pointer-only picking of a pixel position has no keyboard equivalent; the point list below, with its own Remove buttons, is the keyboard-accessible path. */}
          <div
            id={`input-points-${input.id}`}
            style={{
              position: "relative",
              display: "inline-block",
              maxWidth: 400,
              cursor: "crosshair",
            }}
            onClick={handleFrameClick}
          >
            <video
              ref={videoRef}
              src={`/api/uploads/${uploadId}`}
              muted
              playsInline
              preload="metadata"
              style={{ width: "100%", height: "auto", display: "block" }}
            />
            {crop && frame && (
              <div
                aria-hidden
                className="workbench-points-crop"
                style={{
                  position: "absolute",
                  left: `${(crop.left / frame.width) * 100}%`,
                  top: `${(crop.top / frame.height) * 100}%`,
                  width: `${(crop.width / frame.width) * 100}%`,
                  height: `${(crop.height / frame.height) * 100}%`,
                  outline: "2px solid",
                  pointerEvents: "none",
                }}
              />
            )}
            {points.map((point, index) => (
              <div
                key={`${point.x}-${point.y}-${index}`}
                aria-hidden
                className="workbench-points-marker"
                style={{
                  position: "absolute",
                  left: `${point.x * 100}%`,
                  top: `${point.y * 100}%`,
                  width: 10,
                  height: 10,
                  marginLeft: -5,
                  marginTop: -5,
                  borderRadius: "50%",
                  pointerEvents: "none",
                }}
              />
            ))}
          </div>
          <p>
            {points.length}/10 points picked. Click the frame inside the outline
            to add one, or click a point to remove it.
          </p>
          {points.length > 0 && (
            <ul>
              {points.map((point, index) => (
                <li key={`${point.x}-${point.y}-${index}`}>
                  ({point.x.toFixed(2)}, {point.y.toFixed(2)}){" "}
                  <button type="button" onClick={() => removePoint(index)}>
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {note && (
        // biome-ignore lint/a11y/useSemanticElements: <output> is for a form's calculated result, not this status message
        <p role="status">{note}</p>
      )}
      {issue && (
        <p id={issueId} role="alert">
          {issue}
        </p>
      )}
    </div>
  );
}
