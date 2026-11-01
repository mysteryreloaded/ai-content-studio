import { useQuery } from "@tanstack/react-query";
import { useEventStream } from "./lib/sse.js";

export interface PauseNotice {
  paused: boolean;
  notice: string;
}

const PAUSE_NOTICE_KEY = ["pause-notice"];
const DEFAULT_PAUSE_NOTICE: PauseNotice = { paused: false, notice: "" };

/**
 * The Notice/Pause banner's live state (issue #59): works signed out
 * too, over one shared SSE stream for everyone. The stream's `notice`
 * events feed the `["pause-notice"]` query, so every consumer (the
 * NoticeBanner, the Workbench, the Gallery, ...) reads one cache instead
 * of each holding its own copy of the state.
 */
export function usePauseNotice(): PauseNotice {
  useEventStream("/api/site-settings/notice-stream", {
    notice: (queryClient, data) => {
      queryClient.setQueryData(PAUSE_NOTICE_KEY, data as PauseNotice);
    },
  });
  // A new stream connection always sends the current snapshot first, so
  // the cache only needs writing, never a refetch.
  const { data } = useQuery({
    queryKey: PAUSE_NOTICE_KEY,
    queryFn: async () => DEFAULT_PAUSE_NOTICE,
    initialData: DEFAULT_PAUSE_NOTICE,
    staleTime: Number.POSITIVE_INFINITY,
  });
  return data ?? DEFAULT_PAUSE_NOTICE;
}
