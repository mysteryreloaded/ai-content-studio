import { useQuery } from "@tanstack/react-query";
import { api, ok } from "./lib/api.js";

export interface SiteTerms {
  version: number | null;
  body: string;
  versionDate: string | null;
}

export type SiteTermsState =
  | { status: "loading" }
  | { status: "loaded"; terms: SiteTerms };

/** The current Site terms (issue #60), from `/api/terms`. Works signed out. */
export function useSiteTerms(): SiteTermsState {
  // Stays "loading" when no data is in the cache yet — including through
  // the retries of a failed first fetch — rather than showing a wrong
  // "no terms" state.
  const { data } = useQuery({
    queryKey: ["terms"],
    queryFn: () => ok<SiteTerms>(api.api.terms.$get()),
  });
  return data === undefined
    ? { status: "loading" }
    : { status: "loaded", terms: data };
}
