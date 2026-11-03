import { describe, expect, test } from "bun:test";

import {
  formatBytes,
  formatDuration,
  formatGiB,
  formatTime,
  formatWhen,
} from "./format.js";

describe("formatTime", () => {
  test("renders hours and minutes, zero-padded", () => {
    const iso = new Date(2026, 9, 22, 21, 57).toISOString();
    expect(formatTime(iso)).toBe("21:57");
  });

  test("zero-pads single-digit hours and minutes", () => {
    const iso = new Date(2026, 9, 22, 9, 5).toISOString();
    expect(formatTime(iso)).toBe("09:05");
  });
});

describe("formatWhen", () => {
  test("omits the year when the date is in the current year", () => {
    const now = new Date();
    const iso = new Date(now.getFullYear(), 9, 22, 21, 57).toISOString();
    expect(formatWhen(iso)).toBe("22 Oct 21:57");
  });

  test("adds the year when the date is not in the current year", () => {
    const iso = new Date(2025, 9, 22, 21, 57).toISOString();
    expect(formatWhen(iso)).toBe("22 Oct 2025 21:57");
  });
});

describe("formatBytes", () => {
  test("renders plain bytes under 1 KB", () => {
    expect(formatBytes(512)).toBe("512 B");
  });

  test("renders KB with no decimal", () => {
    expect(formatBytes(834 * 1024)).toBe("834 KB");
  });

  test("renders MB with one decimal", () => {
    expect(formatBytes(1.2 * 1024 * 1024)).toBe("1.2 MB");
  });

  test("renders GB with one decimal", () => {
    expect(formatBytes(3.4 * 1024 * 1024 * 1024)).toBe("3.4 GB");
  });
});

describe("formatGiB", () => {
  test("renders GiB to one decimal", () => {
    expect(formatGiB(20 * 1024 * 1024 * 1024)).toBe("20.0 GiB");
  });
});

describe("formatDuration", () => {
  test("renders seconds under a minute", () => {
    expect(formatDuration(45_000)).toBe("45 s");
  });

  test("renders whole minutes under an hour", () => {
    expect(formatDuration(4 * 60_000)).toBe("4 min");
  });

  test("renders hours and minutes over an hour", () => {
    expect(formatDuration(72 * 60_000)).toBe("1 h 12 min");
  });

  test("omits minutes when the duration is an exact number of hours", () => {
    expect(formatDuration(120 * 60_000)).toBe("2 h");
  });
});
