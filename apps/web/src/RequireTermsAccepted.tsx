import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useSession } from "./useSession.js";
import { useSiteTerms } from "./useSiteTerms.js";

/**
 * Wraps a page that needs `active`/`admin` server access (issue #60):
 * once signed in, redirects to `/terms` until the current version is
 * accepted, same as the server's 403 `terms_required` would. Signed-out
 * visitors pass through untouched — the server only gates a session.
 */
export function RequireTermsAccepted({ children }: { children: ReactNode }) {
  const { session } = useSession();
  const terms = useSiteTerms();
  const location = useLocation();

  if (session.status === "loading" || terms.status === "loading") {
    return null;
  }

  if (
    session.status === "signed-in" &&
    terms.terms.version !== null &&
    session.user.termsAcceptedVersion !== terms.terms.version
  ) {
    const returnTo = encodeURIComponent(
      `${location.pathname}${location.search}`,
    );
    return <Navigate to={`/terms?return_to=${returnTo}`} replace />;
  }

  return <>{children}</>;
}
