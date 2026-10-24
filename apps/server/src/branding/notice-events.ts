// In-process pub/sub for the Notice/Pause banner (issue #59): one SSE
// stream, shared by everyone signed in or out, subscribes here, and a
// Notice or Pause/Resume save publishes here. Mirrors
// `generations/events.ts`'s pattern, but with a single, unkeyed audience
// instead of one per user.

import type { PauseNoticeSnapshot } from "./site-settings-store.js";

export class NoticeEvents {
  private readonly listeners = new Set<
    (snapshot: PauseNoticeSnapshot) => void
  >();

  subscribe(listener: (snapshot: PauseNoticeSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  publish(snapshot: PauseNoticeSnapshot): void {
    for (const listener of this.listeners) listener(snapshot);
  }
}
