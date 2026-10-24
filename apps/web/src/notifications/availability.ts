export interface NotificationAvailabilityInput {
  hasNotification: boolean;
  pointerFine: boolean;
  isMobileUserAgentData: boolean;
}

/**
 * Desktop-only gate for issue #58's Notifications AC: Android Chrome exposes
 * `Notification`, but `new Notification()` throws "Illegal constructor"
 * there, so the API's presence alone isn't enough — a fine pointer and no
 * mobile User-Agent Data hint are both required too.
 */
export function isDesktopNotificationAvailable(
  input: NotificationAvailabilityInput,
): boolean {
  return (
    input.hasNotification && input.pointerFine && !input.isMobileUserAgentData
  );
}
