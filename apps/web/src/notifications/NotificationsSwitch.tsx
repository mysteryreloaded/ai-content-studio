import { Label } from "../components/ui/label.js";
import { Switch } from "../components/ui/switch.js";
import { isNotificationSupported } from "./browserNotification.js";
import { useNotificationsPreference } from "./useNotificationsPreference.js";

const SWITCH_ID = "notifications-switch";

/** The Account page's own switch (issue #58's AC), always available next to the first-Submission prompt. */
export function NotificationsSwitch() {
  const { enabled, enable, disable } = useNotificationsPreference();
  const supported = isNotificationSupported();

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Switch
        id={SWITCH_ID}
        checked={enabled}
        disabled={!supported}
        onCheckedChange={(checked) => {
          if (checked) void enable();
          else disable();
        }}
      />
      <Label htmlFor={SWITCH_ID}>
        Notify me in this browser when a Submission ends
      </Label>
      {!supported && (
        <span className="text-[12.5px] text-muted-foreground">
          (not supported in this browser)
        </span>
      )}
    </div>
  );
}
