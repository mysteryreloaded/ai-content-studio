import { TERMS_MAX_LENGTH, renderMarkdown } from "@ai-content-studio/shared";
import { type FormEvent, useEffect, useState } from "react";

interface AdminSiteTerms {
  version: number;
  termsBody: string;
  termsVersion: number | null;
  termsVersionCreatedAt: string | null;
}

type SaveState =
  | { status: "idle" }
  | { status: "saving" }
  | { status: "error"; message: string }
  | { status: "saved" };

/** The Site terms form, shown in the Admin panel next to branding. */
export function SiteTermsForm() {
  const [settings, setSettings] = useState<AdminSiteTerms | null>(null);
  const [body, setBody] = useState("");
  const [askAgain, setAskAgain] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>({ status: "idle" });

  useEffect(() => {
    fetch("/api/admin/site-settings")
      .then((res) => res.json() as Promise<AdminSiteTerms>)
      .then((data) => {
        setSettings(data);
        setBody(data.termsBody);
      })
      .catch(() => {});
  }, []);

  if (!settings) return <p>Loading…</p>;

  const bodyError =
    body.length > TERMS_MAX_LENGTH
      ? `Terms must be ${TERMS_MAX_LENGTH.toLocaleString()} characters or fewer`
      : null;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (bodyError || !settings) return;

    setSaveState({ status: "saving" });
    const res = await fetch("/api/admin/site-settings/terms", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version: settings.version, body, askAgain }),
    });

    if (res.status === 409) {
      setSaveState({
        status: "error",
        message: "changed by someone else, reload",
      });
      return;
    }
    if (!res.ok) {
      setSaveState({ status: "error", message: "save failed" });
      return;
    }

    const updated = (await res.json()) as AdminSiteTerms;
    setSettings(updated);
    setBody(updated.termsBody);
    setAskAgain(false);
    setSaveState({ status: "saved" });
  }

  return (
    <form onSubmit={(event) => void handleSubmit(event)}>
      <h2>Site terms</h2>
      <p>
        {settings.termsVersion === null
          ? "No terms are set: everyone can use the studio without accepting anything."
          : `Current version ${settings.termsVersion}, effective ${
              settings.termsVersionCreatedAt
                ? new Date(settings.termsVersionCreatedAt).toLocaleDateString()
                : "unknown"
            }.`}
      </p>

      <label htmlFor="terms-body">Terms (Markdown)</label>
      <textarea
        id="terms-body"
        rows={12}
        value={body}
        maxLength={TERMS_MAX_LENGTH}
        onChange={(event) => setBody(event.target.value)}
      />
      {bodyError && <p role="alert">{bodyError}</p>}

      <h3>Preview</h3>
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: renderMarkdown (shared) strips raw HTML and images */}
      <div dangerouslySetInnerHTML={{ __html: renderMarkdown(body) }} />

      <label>
        <input
          type="checkbox"
          checked={askAgain}
          onChange={(event) => setAskAgain(event.target.checked)}
        />
        Ask everyone to accept again
      </label>

      <button
        type="submit"
        disabled={!!bodyError || saveState.status === "saving"}
      >
        Save
      </button>
      {saveState.status === "error" && <p role="alert">{saveState.message}</p>}
      {saveState.status === "saved" && <p>Saved.</p>}
    </form>
  );
}
