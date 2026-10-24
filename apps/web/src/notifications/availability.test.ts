import { describe, expect, test } from "bun:test";
import { isDesktopNotificationAvailable } from "./availability.js";

describe("isDesktopNotificationAvailable", () => {
  test("available on a desktop browser with Notification and a fine pointer", () => {
    expect(
      isDesktopNotificationAvailable({
        hasNotification: true,
        pointerFine: true,
        isMobileUserAgentData: false,
      }),
    ).toBe(true);
  });

  test("unavailable without the Notification API", () => {
    expect(
      isDesktopNotificationAvailable({
        hasNotification: false,
        pointerFine: true,
        isMobileUserAgentData: false,
      }),
    ).toBe(false);
  });

  test("unavailable on a coarse pointer, even with Notification present", () => {
    expect(
      isDesktopNotificationAvailable({
        hasNotification: true,
        pointerFine: false,
        isMobileUserAgentData: false,
      }),
    ).toBe(false);
  });

  test("unavailable when User-Agent Data flags a mobile device (Android Chrome)", () => {
    expect(
      isDesktopNotificationAvailable({
        hasNotification: true,
        pointerFine: true,
        isMobileUserAgentData: true,
      }),
    ).toBe(false);
  });
});
