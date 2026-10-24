import { useEffect, useState } from "react";

export interface PauseNotice {
  paused: boolean;
  /** The Admin's own raw Notice text; "" when unset. Resolve the standard fallback with `effectiveNoticeText` (shared) before showing it. */
  notice: string;
}

type Listener = (notice: PauseNotice) => void;

// Module-level singleton: every `usePauseNotice` caller in a tab (the
// NoticeBanner, the Workbench, the Gallery, ...) shares one EventSource
// instead of each opening its own, which would burn through HTTP/1.1's
// six-connections-per-origin limit after just a couple of tabs.
let snapshot: PauseNotice = { paused: false, notice: "" };
let source: EventSource | null = null;
const listeners = new Set<Listener>();

function ensureStream(): void {
  if (source) return;
  const opened = new EventSource("/api/site-settings/notice-stream");
  opened.addEventListener("notice", (event) => {
    snapshot = JSON.parse((event as MessageEvent).data) as PauseNotice;
    for (const listener of listeners) listener(snapshot);
  });
  source = opened;
}

function releaseStream(): void {
  source?.close();
  source = null;
  // Nobody's listening, so there's nothing fresher to show than the
  // default; a later subscriber reconnects and gets a real snapshot
  // instead of inheriting a possibly stale one from a past mount.
  snapshot = { paused: false, notice: "" };
}

/** The Notice/Pause banner's live state (issue #59): works signed out too, over one shared SSE stream for everyone. */
export function usePauseNotice(): PauseNotice {
  const [state, setState] = useState<PauseNotice>(snapshot);

  useEffect(() => {
    listeners.add(setState);
    ensureStream();
    return () => {
      listeners.delete(setState);
      if (listeners.size === 0) releaseStream();
    };
  }, []);

  return state;
}
