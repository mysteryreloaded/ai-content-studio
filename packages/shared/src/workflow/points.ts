// Points Input (issue #52): a user clicks who to replace on the first
// frame of their trimmed video, inside an outlined crop matching the
// Mode's Width/Height Node fields. A point is stored as a fraction (0-1)
// of that first frame; `resolvePointsPixels` reproduces `ImageScale`'s
// own centre crop (ComfyUI's `common_upscale`, `crop: "center"`) to turn
// it into the whole pixel the Workflow receives.

export interface Point {
  x: number;
  y: number;
}

export interface CropRegion {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Python's `round()`: half rounds to the nearest even integer, not
 * always up. `common_upscale`'s own crop offsets use it, so matching it
 * here is what "reproduces ImageScale's centre crop" means for a frame
 * whose crop amount lands exactly on a half pixel.
 */
export function roundHalfToEven(n: number): number {
  const floor = Math.floor(n);
  const diff = n - floor;
  const EPSILON = 1e-9;
  if (diff < 0.5 - EPSILON) return floor;
  if (diff > 0.5 + EPSILON) return floor + 1;
  return floor % 2 === 0 ? floor : floor + 1;
}

/**
 * The region of a `frameWidth` x `frameHeight` frame that `ImageScale`'s
 * `crop: "center"` keeps before scaling to `targetWidth` x `targetHeight`
 * (ComfyUI's `common_upscale`): whichever side is too wide for the
 * target aspect loses `round-half-to-even` pixels, split floor/ceil
 * between its two edges (an odd amount leaves the extra pixel on the
 * bottom/right, the same floor-division both offsets use).
 */
export function centerCropRegion(
  frameWidth: number,
  frameHeight: number,
  targetWidth: number,
  targetHeight: number,
): CropRegion {
  const oldAspect = frameWidth / frameHeight;
  const newAspect = targetWidth / targetHeight;

  let cropX = 0;
  let cropY = 0;
  if (oldAspect > newAspect) {
    cropX = roundHalfToEven(frameWidth - frameWidth * (newAspect / oldAspect));
  } else if (oldAspect < newAspect) {
    cropY = roundHalfToEven(
      frameHeight - frameHeight * (oldAspect / newAspect),
    );
  }

  const left = Math.floor(cropX / 2);
  const top = Math.floor(cropY / 2);
  return {
    left,
    top,
    width: frameWidth - left - Math.floor(cropX / 2),
    height: frameHeight - top - Math.floor(cropY / 2),
  };
}

/** Whether a fraction-of-frame `point` lands inside `crop` (inclusive of its edges). */
export function isPointInCrop(
  point: Point,
  frameWidth: number,
  frameHeight: number,
  crop: CropRegion,
): boolean {
  const px = point.x * frameWidth;
  const py = point.y * frameHeight;
  const EPSILON = 1e-6;
  return (
    px >= crop.left - EPSILON &&
    px <= crop.left + crop.width + EPSILON &&
    py >= crop.top - EPSILON &&
    py <= crop.top + crop.height + EPSILON
  );
}

/**
 * One fraction-of-frame `point`, cropped and scaled the way
 * `ImageScale` would scale the frame itself, rounded to the whole pixel
 * the Workflow receives.
 */
export function pointToPixel(
  point: Point,
  frameWidth: number,
  frameHeight: number,
  targetWidth: number,
  targetHeight: number,
): Point {
  const crop = centerCropRegion(
    frameWidth,
    frameHeight,
    targetWidth,
    targetHeight,
  );
  const px = point.x * frameWidth - crop.left;
  const py = point.y * frameHeight - crop.top;
  return {
    x: Math.round((px / crop.width) * targetWidth),
    y: Math.round((py / crop.height) * targetHeight),
  };
}

/** {@link pointToPixel} for every point, in order. */
export function resolvePointsPixels(
  points: readonly Point[],
  frameWidth: number,
  frameHeight: number,
  targetWidth: number,
  targetHeight: number,
): Point[] {
  return points.map((point) =>
    pointToPixel(point, frameWidth, frameHeight, targetWidth, targetHeight),
  );
}

/**
 * Why `points` (fractions of the first frame) can't be used, or null:
 * 1-10 points, each coordinate in [0, 1], each inside the crop
 * `targetWidth`/`targetHeight` would keep of `frameWidth`/`frameHeight`.
 */
export function pointsValidationIssue(
  points: readonly Point[],
  frameWidth: number,
  frameHeight: number,
  targetWidth: number,
  targetHeight: number,
): string | null {
  if (points.length < 1 || points.length > 10) {
    return "needs 1-10 points";
  }
  for (const point of points) {
    if (
      !Number.isFinite(point.x) ||
      !Number.isFinite(point.y) ||
      point.x < 0 ||
      point.x > 1 ||
      point.y < 0 ||
      point.y > 1
    ) {
      return "every point must be within the frame";
    }
  }
  const crop = centerCropRegion(
    frameWidth,
    frameHeight,
    targetWidth,
    targetHeight,
  );
  for (const point of points) {
    if (!isPointInCrop(point, frameWidth, frameHeight, crop)) {
      return "every point must be inside the crop";
    }
  }
  return null;
}

/** A Points Input's submitted value, as fractions of the first frame (issue #52): `[{"x":…,"y":…}]`. */
export function encodePointsValue(points: readonly Point[]): string {
  return JSON.stringify(points);
}

/** Parses a Points Input's raw string value, or null when it isn't a well-shaped array of `{x,y}` fractions. */
export function decodePointsValue(raw: string): Point[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  const points: Point[] = [];
  for (const entry of parsed) {
    if (
      typeof entry !== "object" ||
      entry === null ||
      typeof (entry as Point).x !== "number" ||
      typeof (entry as Point).y !== "number"
    ) {
      return null;
    }
    points.push({ x: (entry as Point).x, y: (entry as Point).y });
  }
  return points;
}

/** `points` that still fall inside `crop`, dropping the rest (issue #52: a new size drops out-of-crop points with a note). */
export function dropPointsOutsideCrop(
  points: readonly Point[],
  frameWidth: number,
  frameHeight: number,
  targetWidth: number,
  targetHeight: number,
): Point[] {
  const crop = centerCropRegion(
    frameWidth,
    frameHeight,
    targetWidth,
    targetHeight,
  );
  return points.filter((point) =>
    isPointInCrop(point, frameWidth, frameHeight, crop),
  );
}
