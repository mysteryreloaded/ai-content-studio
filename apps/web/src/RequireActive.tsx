import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useSession } from "./useSession.js";

/**
 * Wraps a page that needs `active` server access (issue #62): a pending
 * user is sent to the waiting page instead. Nest inside
 * `RequireTermsAccepted`, so a pending user accepts the Site terms
 * before landing there.
 */
export function RequireActive({ children }: { children: ReactNode }) {
  const { session } = useSession();

  if (session.status === "loading") return null;
  if (session.status === "signed-in" && session.user.status === "pending") {
    return <Navigate to="/waiting" replace />;
  }

  return <>{children}</>;
}
