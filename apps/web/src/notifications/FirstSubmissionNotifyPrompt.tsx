import { useState } from "react";
import { isNotificationSupported } from "./browserNotification.js";
import {
  readNotificationsEnabled,
  readNotificationsPrompted,
  writeNotificationsPrompted,
} from "./preference.js";
import { useNotificationsPreference } from "./useNotificationsPreference.js";

const PROMPT_STYLE = `
.notify-prompt {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin: 0.5rem 0;
}
.notify-prompt p {
  margin: 0;
}
`;

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
    <aside role="note" className="notify-prompt">
      <style>{PROMPT_STYLE}</style>
      <p>Get a browser notification when a Submission finishes?</p>
      <button
        type="button"
        onClick={() => {
          void enable().finally(dismiss);
        }}
      >
        Turn on
      </button>
      <button type="button" onClick={dismiss}>
        Not now
      </button>
    </aside>
  );
}
