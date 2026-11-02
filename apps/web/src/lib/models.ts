import { useQuery } from "@tanstack/react-query";
import { api, ok } from "./api.js";

/** One enabled Model, as `/api/models` returns it (the Admin's `sortOrder`). */
export interface EnabledModel {
  id: string;
  slug: string;
  name: string;
  description: string;
  modeCount: number;
  attribution: string;
}

/**
 * The one shared `["models"]` query (issue #175, shared by #188): the
 * Models home, the landing page and the app header all read the same
 * cache entry, so no page fetches the enabled list by hand. A failed
 * request shows `isError` (the pages show an error, the header keeps
 * Gallery and Admin); before the first fetch resolves `isPending` is
 * true and `models` is still empty.
 */
export function useEnabledModels(): {
  models: EnabledModel[];
  isPending: boolean;
  isError: boolean;
} {
  const { data, isPending, isError } = useQuery({
    queryKey: ["models"],
    queryFn: () => ok<{ models: EnabledModel[] }>(api.api.models.$get()),
  });
  return { models: data?.models ?? [], isPending, isError };
}
