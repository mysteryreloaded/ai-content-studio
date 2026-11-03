import type { CapsStatus } from "@ai-content-studio/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { api, ok } from "../../lib/api.js";

export function useCaps() {
  /** This user's Caps and usage (issue #53), for the Workbench foot. */
  const queryClient = useQueryClient();
  const { data: capsStatus = null } = useQuery({
    queryKey: ["caps"],
    queryFn: () => ok<CapsStatus>(api.api.generations.caps.$get()),
  });

  const refreshCaps = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["caps"] });
  }, [queryClient]);

  return { capsStatus, refreshCaps };
}
