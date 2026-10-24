// Thin wrappers over the Notification API itself (issue #58's AC: "the
// browser API calls stay thin and untested" — the decisions above this
// layer are what's covered by tests).

import { isDesktopNotificationAvailable } from "./availability.js";

/** Desktop only (issue #58's AC) — see `isDesktopNotificationAvailable` for why. */
export function isNotificationSupported(): boolean {
  return isDesktopNotificationAvailable({
    hasNotification: typeof Notification !== "undefined",
    pointerFine:
      typeof matchMedia !== "undefined" &&
      matchMedia("(pointer: fine)").matches,
    isMobileUserAgentData: Boolean(
      (navigator as Navigator & { userAgentData?: { mobile?: boolean } })
        .userAgentData?.mobile,
    ),
  });
}

export function getNotificationPermission(): NotificationPermission {
  return isNotificationSupported() ? Notification.permission : "denied";
}

export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!isNotificationSupported()) return "denied";
  return Notification.requestPermission();
}

export interface NotificationContent {
  title: string;
  body: string;
  icon?: string;
}

/** Shows one desktop Notification; a click focuses this tab and runs `onClick`. */
export function showNotification(
  content: NotificationContent,
  onClick: () => void,
): void {
  if (!isNotificationSupported()) return;
  const notification = new Notification(content.title, {
    body: content.body,
    icon: content.icon,
  });
  notification.onclick = () => {
    window.focus();
    onClick();
    notification.close();
  };
}
