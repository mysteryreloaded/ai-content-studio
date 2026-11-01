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
  const { isPending, data } = useQuery({
    queryKey: ["site-terms"],
    queryFn: () => ok<SiteTerms>(api.api.terms.$get()),
  });

  // Stay "loading" rather than show a wrong "no terms" state.
  if (isPending || data === undefined) return { status: "loading" };
  return { status: "loaded", terms: data };
}
