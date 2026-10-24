import { isNotificationSupported } from "./browserNotification.js";
import { useNotificationsPreference } from "./useNotificationsPreference.js";

/** The Account page's own switch (issue #58's AC), always available next to the first-Submission prompt. */
export function NotificationsSwitch() {
  const { enabled, enable, disable } = useNotificationsPreference();
  const supported = isNotificationSupported();

  return (
    <label>
      <input
        type="checkbox"
        checked={enabled}
        disabled={!supported}
        onChange={(event) => {
          if (event.target.checked) void enable();
          else disable();
        }}
      />
      Notify me in this browser when a Submission ends
      {!supported && <span> (not supported in this browser)</span>}
    </label>
  );
}
