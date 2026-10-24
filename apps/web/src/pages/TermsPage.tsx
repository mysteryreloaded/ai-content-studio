import { renderMarkdown } from "@ai-content-studio/shared";
import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useSession } from "../useSession.js";
import { useSiteTerms } from "../useSiteTerms.js";

function sanitizeReturnTo(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
  return value;
}

/** `/terms`: works signed out; accepting is only offered once signed in. */
export function TermsPage() {
  const terms = useSiteTerms();
  const { session, refresh } = useSession();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (terms.status === "loading" || session.status === "loading") {
    return null;
  }

  if (terms.terms.version === null) {
    return (
      <main>
        <h1>Terms</h1>
        <p>No Site terms have been set.</p>
      </main>
    );
  }

  const alreadyAccepted =
    session.status === "signed-in" &&
    session.user.termsAcceptedVersion === terms.terms.version;

  async function handleAccept() {
    setAccepting(true);
    setError(null);
    const res = await fetch("/api/terms/accept", { method: "POST" });
    setAccepting(false);
    if (!res.ok) {
      setError("Could not record your acceptance. Please try again.");
      return;
    }
    refresh();
    navigate(sanitizeReturnTo(searchParams.get("return_to")), {
      replace: true,
    });
  }

  return (
    <main>
      <h1>Terms</h1>
      {terms.terms.versionDate && (
        <p>
          Version {terms.terms.version}, effective{" "}
          {new Date(terms.terms.versionDate).toLocaleDateString()}
        </p>
      )}
      <div
        // biome-ignore lint/security/noDangerouslySetInnerHtml: renderMarkdown (shared) strips raw HTML and images
        dangerouslySetInnerHTML={{ __html: renderMarkdown(terms.terms.body) }}
      />

      {session.status === "signed-in" && !alreadyAccepted && (
        <>
          <button type="button" disabled={accepting} onClick={handleAccept}>
            Accept
          </button>
          {error && <p role="alert">{error}</p>}
        </>
      )}
      {session.status === "signed-in" && alreadyAccepted && (
        <p>You've accepted the current version.</p>
      )}
    </main>
  );
}
