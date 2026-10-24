import { describe, expect, test } from "bun:test";
import {
  STANDARD_PAUSE_NOTICE,
  effectiveNoticeText,
  siteNoticeFieldsSchema,
} from "./site-settings.js";

describe("effectiveNoticeText", () => {
  test("not paused, blank: nothing to show", () => {
    expect(effectiveNoticeText(false, "")).toBeNull();
  });

  test("not paused, set: the Admin's own text", () => {
    expect(effectiveNoticeText(false, "Upgrading tonight.")).toBe(
      "Upgrading tonight.",
    );
  });

  test("paused, blank: the standard message", () => {
    expect(effectiveNoticeText(true, "")).toBe(STANDARD_PAUSE_NOTICE);
  });

  test("paused, set: the Admin's own text, not the standard one", () => {
    expect(effectiveNoticeText(true, "Back by 3pm.")).toBe("Back by 3pm.");
  });
});

describe("siteNoticeFieldsSchema", () => {
  test("trims and accepts up to 200 characters", () => {
    const result = siteNoticeFieldsSchema.safeParse({ text: "  Hello  " });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.text).toBe("Hello");
  });

  test("refuses more than 200 characters", () => {
    const result = siteNoticeFieldsSchema.safeParse({
      text: "a".repeat(201),
    });
    expect(result.success).toBe(false);
  });
});
