import { useQuery } from "@tanstack/react-query";
import { api, ok } from "../../../lib/api.js";
import type { ModelDetail } from "../types.js";

/** The Model's own load (issue #213): `useQuery` + the typed `api` client, replacing the old `fetch` in `useModelEditor`. */
export function useModelDetail(id: string | undefined) {
  return useQuery({
    queryKey: ["admin-model", id],
    queryFn: () =>
      ok<ModelDetail>(
        api.api.admin.models[":id"].$get({ param: { id: id as string } }),
      ),
    enabled: Boolean(id),
  });
}
