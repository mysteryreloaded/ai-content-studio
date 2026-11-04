import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ok } from "../../../lib/api.js";
import type { RevisionSummary } from "../types.js";

/**
 * The Revisions section's own load (issue #259, replacing the old
 * `fetch` in `useModelEditor`): every numbered revision, newest first
 * as the server already returns them. Restore itself stays in
 * `useModelEditor`, since a successful one needs `useModelDraft`'s own
 * `reload()` to reseed the Inputs/Modes/Terms drafts, not just a
 * refetch of this list.
 */
export function useRevisionsSection(id: string | undefined) {
  const queryClient = useQueryClient();
  const queryKey = ["admin-model-revisions", id] as const;

  const revisionsQuery = useQuery({
    queryKey,
    queryFn: () =>
      ok<{ revisions: RevisionSummary[] }>(
        api.api.admin.models[":id"].revisions.$get({
          param: { id: id as string },
        }),
      ).then((body) => body.revisions),
    enabled: Boolean(id),
  });

  return {
    revisions: revisionsQuery.data ?? null,
    revisionsLoadError: revisionsQuery.isError
      ? "could not load revisions"
      : null,
    invalidate: () => void queryClient.invalidateQueries({ queryKey }),
  };
}

export type RevisionsSectionData = ReturnType<typeof useRevisionsSection>;
