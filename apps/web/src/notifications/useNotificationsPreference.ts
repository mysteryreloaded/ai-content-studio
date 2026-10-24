import { useCallback, useEffect, useState } from "react";
import { requestNotificationPermission } from "./browserNotification.js";
import {
  readNotificationsEnabled,
  writeNotificationsEnabled,
} from "./preference.js";

// Mirrors `useTheme.ts`'s same-tab pub/sub: `localStorage`'s own `storage`
// event never fires in the tab that made the change, so the Account
// page's switch and the first-Submission prompt would otherwise only
// agree after a reload.
const listeners = new Set<(enabled: boolean) => void>();

function publish(enabled: boolean): void {
  for (const listener of listeners) listener(enabled);
}

export interface NotificationsPreference {
  enabled: boolean;
  /** Requests the browser's own permission; only persists "on" once it's granted. */
  enable: () => Promise<boolean>;
  disable: () => void;
}

/** The per-browser Notifications switch (issue #58), shared by the Account page and the first-Submission prompt. */
export function useNotificationsPreference(): NotificationsPreference {
  const [enabled, setEnabled] = useState<boolean>(readNotificationsEnabled);

  useEffect(() => {
    listeners.add(setEnabled);
    return () => {
      listeners.delete(setEnabled);
    };
  }, []);

  const enable = useCallback(async () => {
    const permission = await requestNotificationPermission();
    const granted = permission === "granted";
    writeNotificationsEnabled(granted);
    publish(granted);
    return granted;
  }, []);

  const disable = useCallback(() => {
    writeNotificationsEnabled(false);
    publish(false);
  }, []);

  return { enabled, enable, disable };
}
