import { renderMarkdown } from "@ai-content-studio/shared";
import { useMutation } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "../components/ui/button.js";
import { api, ok } from "../lib/api.js";
import { useSession } from "../useSession.js";
import { useSiteTerms } from "../useSiteTerms.js";

function sanitizeReturnTo(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
  return value;
}

const ACCEPT_ERROR = "Could not record your acceptance. Please try again.";

// The Markdown column's look (issue #174): the typography plugin's
// `prose`, links in the site accent, no second max-width inside the
// page's own readable column.
const proseClass = "prose max-w-none prose-a:text-primary dark:prose-invert";

/** `/terms`: works signed out; accepting is only offered once signed in. */
export function TermsPage() {
  const terms = useSiteTerms();
  const { session, refresh } = useSession();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  // Same request the old `fetch("/api/terms/accept")` made, now through the
  // typed client; a failure throws out of `ok` and lands here (#174).
  const { isPending, error, mutate } = useMutation({
    mutationFn: () =>
      ok<{ ok: true; version: number }>(api.api.terms.accept.$post()),
    onSuccess: () => {
      refresh();
      navigate(sanitizeReturnTo(searchParams.get("return_to")), {
        replace: true,
      });
    },
  });

  if (terms.status === "loading" || session.status === "loading") {
    return null;
  }

  if (terms.terms.version === null) {
    return (
      <main className="mx-auto w-full max-w-[72ch]">
        <h1>Terms</h1>
        <p className="text-muted-foreground">No Site terms have been set.</p>
      </main>
    );
  }

  const alreadyAccepted =
    session.status === "signed-in" &&
    session.user.termsAcceptedVersion === terms.terms.version;

  return (
    <main className="mx-auto w-full max-w-[72ch]">
      <h1>Terms</h1>
      {terms.terms.versionDate && (
        <p className="text-[12.5px] text-muted-foreground">
          Version {terms.terms.version}, effective{" "}
          {new Date(terms.terms.versionDate).toLocaleDateString()}
        </p>
      )}
      <div
        className={proseClass}
        // biome-ignore lint/security/noDangerouslySetInnerHtml: renderMarkdown (shared) strips raw HTML and images
        dangerouslySetInnerHTML={{
          __html: renderMarkdown(terms.terms.body),
        }}
      />

      {session.status === "signed-in" && !alreadyAccepted && (
        <div className="mt-6 space-y-2">
          <Button type="button" disabled={isPending} onClick={() => mutate()}>
            Accept
          </Button>
          {error && (
            <p role="alert" className="text-err">
              {ACCEPT_ERROR}
            </p>
          )}
        </div>
      )}
      {session.status === "signed-in" && alreadyAccepted && (
        <p className="mt-6">You've accepted the current version.</p>
      )}
    </main>
  );
}
