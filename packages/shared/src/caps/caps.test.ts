import { describe, expect, test } from "bun:test";
import {
  type CapsStatus,
  capsFooterText,
  concurrentRemaining,
  dailyRemaining,
  effectiveCap,
} from "./caps.js";

describe("effectiveCap", () => {
  test("uses the Site default when there's no override", () => {
    expect(effectiveCap(20, null)).toBe(20);
  });

  test("an override, including 0, wins over the Site default", () => {
    expect(effectiveCap(20, 5)).toBe(5);
    expect(effectiveCap(20, 0)).toBe(0);
  });
});

describe("dailyRemaining / concurrentRemaining", () => {
  test("never negative, even if usage exceeds a since-lowered Cap", () => {
    const status: CapsStatus = {
      dailyCap: 10,
      dailyUsed: 15,
      concurrentCap: 2,
      concurrentUsed: 5,
      oldestCountedSubmittedAt: null,
    };
    expect(dailyRemaining(status)).toBe(0);
    expect(concurrentRemaining(status)).toBe(0);
  });
});

describe("capsFooterText", () => {
  const now = new Date("2026-10-24T12:00:00Z");

  test("the AC's own example, plenty left: no next-slot clause", () => {
    const status: CapsStatus = {
      dailyCap: 30,
      dailyUsed: 8,
      concurrentCap: 4,
      concurrentUsed: 2,
      oldestCountedSubmittedAt: null,
    };
    expect(capsFooterText(status, now)).toBe(
      "22 of 30 left today · 2 more at once",
    );
  });

  test("low daily remaining with an oldest counted Generation: names when the next slot frees", () => {
    const status: CapsStatus = {
      dailyCap: 20,
      dailyUsed: 19,
      concurrentCap: 4,
      concurrentUsed: 1,
      oldestCountedSubmittedAt: new Date(
        now.getTime() - 20 * 60 * 60 * 1000,
      ).toISOString(),
    };
    expect(capsFooterText(status, now)).toBe(
      "1 of 20 left today · 3 more at once · next slot frees in 4h",
    );
  });

  test("at the daily Cap with the window already elapsed: free now, not a negative duration", () => {
    const status: CapsStatus = {
      dailyCap: 20,
      dailyUsed: 20,
      concurrentCap: 4,
      concurrentUsed: 0,
      oldestCountedSubmittedAt: new Date(
        now.getTime() - 25 * 60 * 60 * 1000,
      ).toISOString(),
    };
    expect(capsFooterText(status, now)).toBe(
      "0 of 20 left today · 4 more at once · next slot free now",
    );
  });

  test("low daily remaining but nothing counted yet (e.g. a lowered Cap): no next-slot clause", () => {
    const status: CapsStatus = {
      dailyCap: 2,
      dailyUsed: 0,
      concurrentCap: 4,
      concurrentUsed: 0,
      oldestCountedSubmittedAt: null,
    };
    expect(capsFooterText(status, now)).toBe(
      "2 of 2 left today · 4 more at once",
    );
  });

  test("concurrent Cap exhausted but daily isn't low: no next-slot clause (no predictable ETA)", () => {
    const status: CapsStatus = {
      dailyCap: 30,
      dailyUsed: 5,
      concurrentCap: 4,
      concurrentUsed: 4,
      oldestCountedSubmittedAt: new Date(
        now.getTime() - 1 * 60 * 60 * 1000,
      ).toISOString(),
    };
    expect(capsFooterText(status, now)).toBe(
      "25 of 30 left today · 0 more at once",
    );
  });
});
