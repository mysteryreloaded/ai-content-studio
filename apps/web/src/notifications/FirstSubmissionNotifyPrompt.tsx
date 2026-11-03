import { useState } from "react";
import { Button } from "../components/ui/button.js";
import { isNotificationSupported } from "./browserNotification.js";
import {
  readNotificationsEnabled,
  readNotificationsPrompted,
  writeNotificationsPrompted,
} from "./preference.js";
import { useNotificationsPreference } from "./useNotificationsPreference.js";

function shouldOfferPrompt(): boolean {
  return (
    isNotificationSupported() &&
    !readNotificationsPrompted() &&
    !readNotificationsEnabled()
  );
}

/** Offered on the first Submission block (issue #58's AC): Turn on / Not now, shown once per browser. */
export function FirstSubmissionNotifyPrompt() {
  const { enable } = useNotificationsPreference();
  const [visible, setVisible] = useState(shouldOfferPrompt);

  if (!visible) return null;

  const dismiss = () => {
    writeNotificationsPrompted();
    setVisible(false);
  };

  return (
    <aside
      role="note"
      className="flex flex-wrap items-center gap-2 rounded-md bg-muted px-2.5 py-1.5 text-[13px]"
    >
      <span>Get notified when this finishes?</span>
      <Button
        type="button"
        variant="link"
        onClick={() => {
          void enable().finally(dismiss);
        }}
      >
        Turn on
      </Button>
      <span className="text-faint">·</span>
      <Button type="button" variant="link" onClick={dismiss}>
        Not now
      </Button>
    </aside>
  );
}
