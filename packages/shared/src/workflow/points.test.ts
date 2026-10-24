import { describe, expect, test } from "bun:test";
import {
  centerCropRegion,
  dropPointsOutsideCrop,
  isPointInCrop,
  pointToPixel,
  pointsValidationIssue,
  resolvePointsPixels,
  roundHalfToEven,
} from "./points.js";

describe("roundHalfToEven", () => {
  test("rounds down/up away from a half as usual", () => {
    expect(roundHalfToEven(2.4)).toBe(2);
    expect(roundHalfToEven(2.6)).toBe(3);
  });

  test("rounds an exact half to the nearest even integer", () => {
    expect(roundHalfToEven(2.5)).toBe(2);
    expect(roundHalfToEven(3.5)).toBe(4);
    expect(roundHalfToEven(0.5)).toBe(0);
    expect(roundHalfToEven(1.5)).toBe(2);
  });
});

describe("centerCropRegion", () => {
  test("no crop when the frame already matches the target aspect", () => {
    expect(centerCropRegion(100, 100, 50, 50)).toEqual({
      left: 0,
      top: 0,
      width: 100,
      height: 100,
    });
  });

  test("crops width evenly when the removed amount is even", () => {
    // old aspect 2:1 (200x100), new aspect 1:1 -> cropX = 200 - 200*(1/2) = 100
    expect(centerCropRegion(200, 100, 50, 50)).toEqual({
      left: 50,
      top: 0,
      width: 100,
      height: 100,
    });
  });

  test("an odd width's crop amount leaves the extra pixel on the right", () => {
    // old aspect 101:100, new aspect 1:1 -> cropX = 101 - 101*(100/101) = 1
    const crop = centerCropRegion(101, 100, 50, 50);
    expect(crop.left).toBe(0);
    expect(crop.width).toBe(101);
  });

  test("a half-pixel crop amount rounds to the nearest even pixel", () => {
    // old aspect 3 (3x1), new aspect 0.5 (1x2):
    // cropX = 3 - 3*(0.5/3) = 2.5 exactly -> rounds to 2 (even)
    const crop = centerCropRegion(3, 1, 1, 2);
    expect(crop.left).toBe(1);
    expect(crop.width).toBe(1);
    expect(crop.top).toBe(0);
    expect(crop.height).toBe(1);
  });

  test("crops height when the frame is taller than the target aspect", () => {
    // old aspect 1:2 (100x200), new aspect 1:1 -> cropY = 200 - 200*(1/0.5) ... computed via formula
    const crop = centerCropRegion(100, 200, 100, 100);
    expect(crop.left).toBe(0);
    expect(crop.width).toBe(100);
    expect(crop.top).toBe(50);
    expect(crop.height).toBe(100);
  });
});

describe("isPointInCrop", () => {
  const crop = centerCropRegion(200, 100, 50, 50);

  test("a point inside the kept region passes", () => {
    expect(isPointInCrop({ x: 0.5, y: 0.5 }, 200, 100, crop)).toBe(true);
  });

  test("a point in the cropped-away margin fails", () => {
    expect(isPointInCrop({ x: 0.1, y: 0.5 }, 200, 100, crop)).toBe(false);
  });

  test("a point exactly on the crop's edge passes", () => {
    // crop.left = 50px of 200 -> fraction 0.25
    expect(isPointInCrop({ x: 0.25, y: 0 }, 200, 100, crop)).toBe(true);
  });
});

describe("pointToPixel / resolvePointsPixels", () => {
  test("the frame's centre maps to the target's centre", () => {
    expect(pointToPixel({ x: 0.5, y: 0.5 }, 200, 100, 50, 50)).toEqual({
      x: 25,
      y: 25,
    });
  });

  test("a point just inside the kept region scales proportionally", () => {
    // crop is x in [50,150] of 200; fraction 0.3 -> px=60, offset from
    // crop.left=50 is 10 of 100 wide crop -> 0.1 of target width 50 = 5
    expect(pointToPixel({ x: 0.3, y: 0.5 }, 200, 100, 50, 50)).toEqual({
      x: 5,
      y: 25,
    });
  });

  test("an odd target width still rounds to whole pixels", () => {
    const result = pointToPixel({ x: 0.5, y: 0.5 }, 200, 100, 51, 51);
    expect(Number.isInteger(result.x)).toBe(true);
    expect(Number.isInteger(result.y)).toBe(true);
  });

  test("resolves every point in order", () => {
    const points = [
      { x: 0.5, y: 0.5 },
      { x: 0.3, y: 0.5 },
    ];
    expect(resolvePointsPixels(points, 200, 100, 50, 50)).toEqual([
      { x: 25, y: 25 },
      { x: 5, y: 25 },
    ]);
  });
});

describe("pointsValidationIssue", () => {
  test("accepts 1-10 points inside [0,1] and the crop", () => {
    expect(
      pointsValidationIssue([{ x: 0.5, y: 0.5 }], 200, 100, 50, 50),
    ).toBeNull();
  });

  test("refuses none or more than 10", () => {
    expect(pointsValidationIssue([], 200, 100, 50, 50)).toContain("1-10");
    const eleven = Array.from({ length: 11 }, () => ({ x: 0.5, y: 0.5 }));
    expect(pointsValidationIssue(eleven, 200, 100, 50, 50)).toContain("1-10");
  });

  test("refuses a coordinate outside [0,1]", () => {
    expect(
      pointsValidationIssue([{ x: 1.1, y: 0.5 }], 200, 100, 50, 50),
    ).not.toBeNull();
  });

  test("refuses a point outside the crop", () => {
    expect(
      pointsValidationIssue([{ x: 0.1, y: 0.5 }], 200, 100, 50, 50),
    ).toContain("crop");
  });
});

describe("dropPointsOutsideCrop", () => {
  test("keeps only points still inside a new crop", () => {
    const points = [
      { x: 0.5, y: 0.5 },
      { x: 0.1, y: 0.5 },
    ];
    expect(dropPointsOutsideCrop(points, 200, 100, 50, 50)).toEqual([
      { x: 0.5, y: 0.5 },
    ]);
  });
});
