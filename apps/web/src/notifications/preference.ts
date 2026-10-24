/** Issue #58: whether this browser shows Notifications, kept per browser like the theme switch (`theme.ts`). */
export const NOTIFICATIONS_STORAGE_KEY = "ai-content-studio:notifications";

/** Set once the first-Submission prompt (Turn on / Not now) has been answered, so it never shows twice. */
export const NOTIFICATIONS_PROMPTED_KEY =
  "ai-content-studio:notifications-prompted";

export function readNotificationsEnabled(): boolean {
  try {
    return localStorage.getItem(NOTIFICATIONS_STORAGE_KEY) === "on";
  } catch {
    return false;
  }
}

export function writeNotificationsEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(NOTIFICATIONS_STORAGE_KEY, enabled ? "on" : "off");
  } catch {
    // Private browsing or blocked storage: the choice still applies for
    // this page view, it just won't be remembered (NoticeBanner.tsx).
  }
}

export function readNotificationsPrompted(): boolean {
  try {
    return localStorage.getItem(NOTIFICATIONS_PROMPTED_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeNotificationsPrompted(): void {
  try {
    localStorage.setItem(NOTIFICATIONS_PROMPTED_KEY, "1");
  } catch {
    // Same as above: worst case the prompt shows again next time.
  }
}
