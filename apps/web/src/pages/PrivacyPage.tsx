import { renderMarkdown } from "@ai-content-studio/shared";
import { useEffect, useState } from "react";
import { Footer } from "../Footer.js";

interface PrivacyData {
  operatorBody: string;
  operatorUpdatedAt: string | null;
  generatedBody: string;
}

type PrivacyState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "loaded"; data: PrivacyData };

/** `/privacy` always exists (issue #65): the Operator's own Markdown, then the studio-written section. */
export function PrivacyPage() {
  const [state, setState] = useState<PrivacyState>({ status: "loading" });

  useEffect(() => {
    fetch("/api/privacy")
      .then((res) => {
        if (!res.ok) throw new Error(`unexpected status ${res.status}`);
        return res.json() as Promise<PrivacyData>;
      })
      .then((data) => setState({ status: "loaded", data }))
      .catch(() => setState({ status: "error" }));
  }, []);

  const data = state.status === "loaded" ? state.data : null;

  return (
    <>
      <main>
        <h1>Privacy</h1>
        {state.status === "loading" && <p>Loading…</p>}
        {state.status === "error" && (
          <p role="alert">
            Could not load the Privacy policy. Please try again.
          </p>
        )}
        {data && (
          <>
            {data.operatorUpdatedAt && (
              <p>
                Last updated{" "}
                {new Date(data.operatorUpdatedAt).toLocaleDateString()}
              </p>
            )}
            {data.operatorBody ? (
              <div
                // biome-ignore lint/security/noDangerouslySetInnerHtml: renderMarkdown (shared) strips raw HTML and images
                dangerouslySetInnerHTML={{
                  __html: renderMarkdown(data.operatorBody),
                }}
              />
            ) : (
              <p>The Operator hasn't published a privacy notice yet.</p>
            )}
            <div
              // biome-ignore lint/security/noDangerouslySetInnerHtml: renderMarkdown (shared) strips raw HTML and images
              dangerouslySetInnerHTML={{
                __html: renderMarkdown(data.generatedBody),
              }}
            />
          </>
        )}
      </main>
      <Footer />
    </>
  );
}
