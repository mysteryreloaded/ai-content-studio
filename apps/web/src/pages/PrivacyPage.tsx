import { renderMarkdown } from "@ai-content-studio/shared";
import { useEffect, useState } from "react";
import { Footer } from "../Footer.js";

interface PrivacyData {
  operatorBody: string;
  operatorUpdatedAt: string | null;
  generatedBody: string;
}

/** `/privacy` always exists (issue #65): the Operator's own Markdown, then the studio-written section. */
export function PrivacyPage() {
  const [data, setData] = useState<PrivacyData | null>(null);

  useEffect(() => {
    fetch("/api/privacy")
      .then((res) => res.json() as Promise<PrivacyData>)
      .then(setData)
      .catch(() => setData(null));
  }, []);

  return (
    <>
      <main>
        <h1>Privacy</h1>
        {data === null && <p>Loading…</p>}
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
