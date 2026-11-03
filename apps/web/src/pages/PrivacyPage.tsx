import { renderMarkdown } from "@ai-content-studio/shared";
import { useQuery } from "@tanstack/react-query";
import { api, ok } from "../lib/api.js";

interface PrivacyData {
  operatorBody: string;
  operatorUpdatedAt: string | null;
  generatedBody: string;
}

const ERROR_MESSAGE = "Could not load the Privacy policy. Please try again.";

// The Markdown column's look (issue #174): the typography plugin's
// `prose`, links in the site accent, no second max-width inside the
// page's own readable column.
const proseClass = "prose max-w-none prose-a:text-primary dark:prose-invert";

/** `/privacy` always exists (issue #65): the Operator's own Markdown, then the studio-written section. */
export function PrivacyPage() {
  // Through the typed client (issue #174). A 200 whose body isn't valid
  // JSON unwraps to `null` through `ok`; the route's shape never
  // legitimately is one, so that reads as the error, like the old
  // `fetch`'s catch did.
  const { data, isError } = useQuery({
    queryKey: ["privacy"],
    queryFn: () => ok<PrivacyData | null>(api.api.privacy.$get()),
  });

  const column = "mx-auto w-full max-w-[72ch] flex flex-col gap-content";

  if (isError || data === null) {
    return (
      <main className={column}>
        <h1>Privacy</h1>
        <p role="alert">{ERROR_MESSAGE}</p>
      </main>
    );
  }

  if (data === undefined) {
    return (
      <main className={column}>
        <h1>Privacy</h1>
        <p>Loading…</p>
      </main>
    );
  }

  return (
    <main className={column}>
      <h1>Privacy</h1>
      {data.operatorUpdatedAt && (
        <p className="text-[12.5px] text-muted-foreground">
          Last updated {new Date(data.operatorUpdatedAt).toLocaleDateString()}
        </p>
      )}
      {data.operatorBody ? (
        <div
          className={proseClass}
          // biome-ignore lint/security/noDangerouslySetInnerHtml: renderMarkdown (shared) strips raw HTML and images
          dangerouslySetInnerHTML={{
            __html: renderMarkdown(data.operatorBody),
          }}
        />
      ) : (
        <p className="text-muted-foreground">
          The Operator hasn't published a privacy notice yet.
        </p>
      )}
      <div
        className={proseClass}
        // biome-ignore lint/security/noDangerouslySetInnerHtml: renderMarkdown (shared) strips raw HTML and images
        dangerouslySetInnerHTML={{
          __html: renderMarkdown(data.generatedBody),
        }}
      />
    </main>
  );
}
