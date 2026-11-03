import type { CapsStatus } from "@ai-content-studio/shared";
import { useCallback, useEffect, useState } from "react";

export function useCaps() {
  /** This user's Caps and usage (issue #53), for the Workbench foot. */
  const [capsStatus, setCapsStatus] = useState<CapsStatus | null>(null);

  const refreshCaps = useCallback(() => {
    fetch("/api/generations/caps")
      .then((res) => (res.ok ? (res.json() as Promise<CapsStatus>) : null))
      .then((status) => {
        if (status) setCapsStatus(status);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    refreshCaps();
  }, [refreshCaps]);

  return { capsStatus, refreshCaps };
}
