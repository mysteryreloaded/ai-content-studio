import { PRIVACY_MAX_LENGTH, renderMarkdown } from "@ai-content-studio/shared";
import { type FormEvent, useEffect, useState } from "react";

interface AdminSitePrivacy {
  privacyBody: string;
  privacyUpdatedAt: string | null;
  privacyRevision: number;
}

type SaveState =
  | { status: "idle" }
  | { status: "saving" }
  | { status: "error"; message: string }
  | { status: "saved" };

/** The Privacy policy's Operator part (issue #65), shown in the Admin panel next to Site terms. */
export function SitePrivacyForm() {
  const [settings, setSettings] = useState<AdminSitePrivacy | null>(null);
  const [body, setBody] = useState("");
  const [saveState, setSaveState] = useState<SaveState>({ status: "idle" });

  useEffect(() => {
    fetch("/api/admin/site-settings")
      .then((res) => res.json() as Promise<AdminSitePrivacy>)
      .then((data) => {
        setSettings(data);
        setBody(data.privacyBody);
      })
      .catch(() => {});
  }, []);

  if (!settings) return <p>Loading…</p>;

  const bodyError =
    body.length > PRIVACY_MAX_LENGTH
      ? `Privacy text must be ${PRIVACY_MAX_LENGTH.toLocaleString()} characters or fewer`
      : null;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (bodyError || !settings) return;

    setSaveState({ status: "saving" });
    const res = await fetch("/api/admin/site-settings/privacy", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ revision: settings.privacyRevision, body }),
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

    const updated = (await res.json()) as AdminSitePrivacy;
    setSettings(updated);
    setBody(updated.privacyBody);
    setSaveState({ status: "saved" });
  }

  return (
    <form onSubmit={(event) => void handleSubmit(event)}>
      <h2>Privacy policy</h2>
      <p>
        This is the Operator's own part of <code>/privacy</code>, shown before a
        studio-written section nobody here can edit.
        {settings.privacyUpdatedAt &&
          ` Last updated ${new Date(settings.privacyUpdatedAt).toLocaleDateString()}.`}
      </p>

      <label htmlFor="privacy-body">Privacy notice (Markdown)</label>
      <textarea
        id="privacy-body"
        rows={12}
        value={body}
        maxLength={PRIVACY_MAX_LENGTH}
        onChange={(event) => setBody(event.target.value)}
      />
      {bodyError && <p role="alert">{bodyError}</p>}

      <h3>Preview</h3>
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: renderMarkdown (shared) strips raw HTML and images */}
      <div dangerouslySetInnerHTML={{ __html: renderMarkdown(body) }} />

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
