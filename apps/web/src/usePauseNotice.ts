import { useQueryClient } from "@tanstack/react-query";
import { useEventStream } from "./lib/sse.js";

export interface PauseNotice {
  paused: boolean;
  /** The Admin's own raw Notice text; "" when unset. Resolve the standard fallback with `effectiveNoticeText` (shared) before showing it. */
  notice: string;
}

/** The default shown until the first SSE snapshot arrives (issue #59). */
export const DEFAULT_PAUSE_NOTICE: PauseNotice = { paused: false, notice: "" };

/**
 * The Notice/Pause banner's live state (issue #59): works signed out too.
 * The only shared SSE stream in the tab feeds a `["pause-notice"]` query
 * (issue #172) instead of component state; `useEventStream` is the only
 * place an `EventSource` is opened, and it is shared by every caller.
 */
export function usePauseNotice(): PauseNotice {
  const queryClient = useQueryClient();

  useEventStream("/api/site-settings/notice-stream", {
    notice: (data, client) =>
      client.setQueryData(
        ["pause-notice"],
        data === null || data === undefined
          ? DEFAULT_PAUSE_NOTICE
          : (data as PauseNotice),
      ),
  });

  return (
    queryClient.getQueryData<PauseNotice>(["pause-notice"]) ??
    DEFAULT_PAUSE_NOTICE
  );
}
