import { useEffect, useState } from "react";

export interface PauseNotice {
  paused: boolean;
  /** The Admin's own raw Notice text; "" when unset. Resolve the standard fallback with `effectiveNoticeText` (shared) before showing it. */
  notice: string;
}

/** The Notice/Pause banner's live state (issue #59): works signed out too, over one shared SSE stream for everyone. */
export function usePauseNotice(): PauseNotice {
  const [state, setState] = useState<PauseNotice>({
    paused: false,
    notice: "",
  });

  useEffect(() => {
    const source = new EventSource("/api/site-settings/notice-stream");
    source.addEventListener("notice", (event) => {
      setState(JSON.parse((event as MessageEvent).data) as PauseNotice);
    });
    return () => source.close();
  }, []);

  return state;
}
