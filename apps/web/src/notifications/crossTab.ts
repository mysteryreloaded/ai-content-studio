// Thin wrappers over BroadcastChannel and Web Locks (issue #58's AC: tabs
// share visibility and own-cancels over BroadcastChannel, and elect one
// notifier with Web Locks). Left untested, like `browserNotification.ts` —
// the decisions built on top of these are what's covered by tests.

const CHANNEL_NAME = "ai-content-studio:tabs";
const NOTIFIER_LOCK_NAME = "ai-content-studio:notifier";

export type TabMessage =
  | { type: "visibility"; tabId: string; visible: boolean }
  | { type: "ownCancel"; submissionId: string };

type Listener = (message: TabMessage) => void;

const listeners = new Set<Listener>();
let channel: BroadcastChannel | null = null;

function ensureChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === "undefined") return null;
  if (!channel) {
    channel = new BroadcastChannel(CHANNEL_NAME);
    channel.onmessage = (event) => {
      for (const listener of listeners) listener(event.data as TabMessage);
    };
  }
  return channel;
}

/** Every open tab (mounted once each, via `useTabNotifier`) hears every other tab's messages. */
export function subscribeTabChannel(listener: Listener): () => void {
  listeners.add(listener);
  ensureChannel();
  return () => {
    listeners.delete(listener);
  };
}

export function postTabMessage(message: TabMessage): void {
  ensureChannel()?.postMessage(message);
}

/**
 * Elects exactly one open tab as the Notifier, so a Submission that ends
 * while several hidden tabs are open raises only one Notification.
 * `onElected` fires once this tab holds the lock; it keeps holding it
 * (the lock's own callback never resolves) until `release()` is called.
 */
export function electNotifier(onElected: () => void): () => void {
  if (typeof navigator === "undefined" || !("locks" in navigator)) {
    // No Web Locks support: act as the notifier alone rather than never notifying.
    onElected();
    return () => {};
  }

  const controller = new AbortController();
  let release: (() => void) | null = null;
  navigator.locks
    .request(
      NOTIFIER_LOCK_NAME,
      { signal: controller.signal },
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
          onElected();
        }),
    )
    .catch(() => {
      // Aborted via cleanup below, or the context torn down (e.g. the tab
      // closed) before the lock was granted.
    });

  return () => {
    if (release) release();
    else controller.abort();
  };
}
