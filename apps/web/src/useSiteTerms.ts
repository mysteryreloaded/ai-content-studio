import { useEffect, useState } from "react";

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
  const [state, setState] = useState<SiteTermsState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    fetch("/api/terms")
      .then((res) => res.json() as Promise<SiteTerms>)
      .then((terms) => {
        if (!cancelled) setState({ status: "loaded", terms });
      })
      .catch(() => {
        /* leave it loading rather than show a wrong "no terms" state */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
