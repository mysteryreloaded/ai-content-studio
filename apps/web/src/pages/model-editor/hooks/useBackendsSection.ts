import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, api, ok } from "../../../lib/api.js";
import type {
  AdminBackendSummary,
  AttachedBackendEntry,
  ObjectInfoBackendJson,
} from "../types.js";

function messageFromApiError(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    const body = error.body as { error?: string } | null;
    return body?.error ?? fallback;
  }
  return fallback;
}

/**
 * The Backends section's own three loads (issue #217, replacing
 * `useModelEditor`'s old `fetch` calls) plus attach/detach as
 * `useMutation`s: on success both invalidate the attached list and
 * `/object-info`, so the checks rail and "Runs on" rows update together.
 */
export function useBackendsSection(id: string | undefined) {
  const queryClient = useQueryClient();

  const attachedQuery = useQuery({
    queryKey: ["admin-model-backends", id],
    queryFn: () =>
      ok<{ backends: AttachedBackendEntry[] }>(
        api.api.admin.models[":id"].backends.$get({
          param: { id: id as string },
        }),
      ),
    enabled: Boolean(id),
  });

  const allBackendsQuery = useQuery({
    queryKey: ["admin-backends"],
    queryFn: () =>
      ok<{ backends: AdminBackendSummary[] }>(api.api.admin.backends.$get()),
  });

  const objectInfoQuery = useQuery({
    queryKey: ["admin-model-object-info", id],
    queryFn: () =>
      ok<{ backends: ObjectInfoBackendJson[] }>(
        api.api.admin.models[":id"]["object-info"].$get({
          param: { id: id as string },
        }),
      ),
    enabled: Boolean(id),
  });

  function invalidate() {
    void queryClient.invalidateQueries({
      queryKey: ["admin-model-backends", id],
    });
    void queryClient.invalidateQueries({
      queryKey: ["admin-model-object-info", id],
    });
  }

  const attachMutation = useMutation({
    mutationFn: (backendId: string) =>
      ok<null>(
        api.api.admin.models[":id"].backends.$post({
          param: { id: id as string },
          json: { backendId },
        }),
      ),
    onSuccess: invalidate,
  });

  const detachMutation = useMutation({
    mutationFn: (backendId: string) =>
      ok<null>(
        api.api.admin.models[":id"].backends[":backendId"].$delete({
          param: { id: id as string, backendId },
        }),
      ),
    onSuccess: invalidate,
  });

  return {
    attachedBackends: attachedQuery.data?.backends ?? null,
    backendsLoadError: attachedQuery.isError ? "could not load Backends" : null,
    allBackends: allBackendsQuery.data?.backends ?? null,
    objectInfo: objectInfoQuery.data?.backends ?? null,
    attach: (backendId: string) => attachMutation.mutateAsync(backendId),
    detach: (backendId: string) => detachMutation.mutateAsync(backendId),
    attaching: attachMutation.isPending,
    attachError: attachMutation.isError
      ? messageFromApiError(
          attachMutation.error,
          "could not attach this Backend",
        )
      : null,
    detachError: detachMutation.isError
      ? messageFromApiError(
          detachMutation.error,
          "could not detach this Backend",
        )
      : null,
  };
}

export type BackendsSectionData = ReturnType<typeof useBackendsSection>;
