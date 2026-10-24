import {
  ACCENT_PALETTES,
  BACKGROUND_MAX_BYTES,
  CONTACT_MAX_LENGTH,
  FOOTER_LINKS_MAX_COUNT,
  FOOTER_LINK_LABEL_MAX_LENGTH,
  type FooterLink,
  LANDING_TEXT_MAX_LENGTH,
  LOGO_MAX_BYTES,
  type SignUpMode,
  TITLE_MAX_LENGTH,
  isAllowedImageContentType,
  isValidContact,
  isValidFooterLinkUrl,
} from "@ai-content-studio/shared";
import { type FormEvent, useEffect, useState } from "react";
import { Link } from "react-router-dom";

interface AdminSiteSettings {
  version: number;
  title: string;
  landingText: string;
  accent: string;
  signUpMode: SignUpMode;
  contact: string;
  footerLinks: FooterLink[];
  logo: { contentType: string; hash: string; size: number } | null;
  background: { contentType: string; hash: string; size: number } | null;
}

type SaveState =
  | { status: "idle" }
  | { status: "saving" }
  | { status: "error"; message: string }
  | { status: "saved" };

/** A React-stable key, since `FooterLink` itself has none and array position isn't stable across edits. */
interface EditableFooterLink extends FooterLink {
  key: number;
}

function withKeys(links: FooterLink[], startKey: number): EditableFooterLink[] {
  return links.map((link, index) => ({ ...link, key: startKey + index }));
}

function validateImage(
  file: File | null,
  which: "logo" | "background",
): string | null {
  if (!file) return null;
  if (!isAllowedImageContentType(file.type)) {
    return `${which} must be a PNG, JPEG or WebP image`;
  }
  const max = which === "logo" ? LOGO_MAX_BYTES : BACKGROUND_MAX_BYTES;
  if (file.size > max) {
    return `${which} must be ${Math.floor(max / (1024 * 1024))} MB or smaller`;
  }
  return null;
}

/** The Site settings branding form, shown in the Admin panel. */
export function SiteSettingsForm() {
  const [settings, setSettings] = useState<AdminSiteSettings | null>(null);
  const [title, setTitle] = useState("");
  const [landingText, setLandingText] = useState("");
  const [accent, setAccent] = useState("teal");
  const [signUpMode, setSignUpMode] = useState<SignUpMode>("approval");
  const [contact, setContact] = useState("");
  const [footerLinks, setFooterLinks] = useState<EditableFooterLink[]>([]);
  const [nextFooterLinkKey, setNextFooterLinkKey] = useState(0);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [backgroundFile, setBackgroundFile] = useState<File | null>(null);
  const [saveState, setSaveState] = useState<SaveState>({ status: "idle" });

  useEffect(() => {
    fetch("/api/admin/site-settings")
      .then((res) => res.json() as Promise<AdminSiteSettings>)
      .then((data) => {
        setSettings(data);
        setTitle(data.title);
        setLandingText(data.landingText);
        setAccent(data.accent);
        setSignUpMode(data.signUpMode);
        setContact(data.contact);
        setFooterLinks(withKeys(data.footerLinks, 0));
        setNextFooterLinkKey(data.footerLinks.length);
      })
      .catch(() => {});
  }, []);

  if (!settings) return <p>Loading…</p>;

  const titleError =
    title.trim().length === 0 || title.length > TITLE_MAX_LENGTH
      ? `Title must be 1–${TITLE_MAX_LENGTH} characters`
      : null;
  const landingTextError =
    landingText.length > LANDING_TEXT_MAX_LENGTH
      ? `Landing text must be ${LANDING_TEXT_MAX_LENGTH} characters or fewer`
      : null;
  const logoError = validateImage(logoFile, "logo");
  const backgroundError = validateImage(backgroundFile, "background");
  const contactError = !isValidContact(contact.trim())
    ? "Contact must be an email address or an http(s) URL"
    : null;
  const footerLinksToSave = footerLinks.filter(
    (link) => link.label.trim() !== "" || link.url.trim() !== "",
  );
  const footerLinksError = footerLinksToSave.some(
    (link) =>
      link.label.trim() === "" ||
      link.label.length > FOOTER_LINK_LABEL_MAX_LENGTH ||
      !isValidFooterLinkUrl(link.url.trim()),
  )
    ? `Each footer link needs a label (≤ ${FOOTER_LINK_LABEL_MAX_LENGTH} characters) and an http(s) URL`
    : null;
  const canSave =
    !titleError &&
    !landingTextError &&
    !logoError &&
    !backgroundError &&
    !contactError &&
    !footerLinksError;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!canSave || !settings) return;

    setSaveState({ status: "saving" });
    const body = new FormData();
    body.set("version", String(settings.version));
    body.set("title", title);
    body.set("landingText", landingText);
    body.set("accent", accent);
    body.set("signUpMode", signUpMode);
    body.set("contact", contact);
    body.set(
      "footerLinks",
      JSON.stringify(
        footerLinksToSave.map((link) => ({
          label: link.label.trim(),
          url: link.url.trim(),
        })),
      ),
    );
    if (logoFile) body.set("logo", logoFile);
    if (backgroundFile) body.set("background", backgroundFile);

    const res = await fetch("/api/admin/site-settings", {
      method: "PUT",
      body,
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

    const updated = (await res.json()) as AdminSiteSettings;
    setSettings(updated);
    setFooterLinks(withKeys(updated.footerLinks, nextFooterLinkKey));
    setNextFooterLinkKey(nextFooterLinkKey + updated.footerLinks.length);
    setLogoFile(null);
    setBackgroundFile(null);
    setSaveState({ status: "saved" });
  }

  return (
    <form onSubmit={(event) => void handleSubmit(event)}>
      <h2>Site settings</h2>
      <Link to="/admin/audit?targetType=site_settings&targetId=singleton">
        History
      </Link>

      <label htmlFor="site-title">Title</label>
      <input
        id="site-title"
        value={title}
        maxLength={TITLE_MAX_LENGTH}
        onChange={(event) => setTitle(event.target.value)}
      />
      {titleError && <p role="alert">{titleError}</p>}

      <label htmlFor="landing-text">Landing text</label>
      <textarea
        id="landing-text"
        value={landingText}
        maxLength={LANDING_TEXT_MAX_LENGTH}
        onChange={(event) => setLandingText(event.target.value)}
      />
      {landingTextError && <p role="alert">{landingTextError}</p>}

      <fieldset>
        <legend>Accent colour</legend>
        {ACCENT_PALETTES.map((palette) => (
          <label key={palette.key}>
            <input
              type="radio"
              name="accent"
              value={palette.key}
              checked={accent === palette.key}
              onChange={() => setAccent(palette.key)}
            />
            {palette.label}
          </label>
        ))}
      </fieldset>

      <fieldset>
        <legend>Sign-up</legend>
        <label>
          <input
            type="radio"
            name="sign-up-mode"
            value="approval"
            checked={signUpMode === "approval"}
            onChange={() => setSignUpMode("approval")}
          />
          Approval: new users wait for an Admin
        </label>
        <label>
          <input
            type="radio"
            name="sign-up-mode"
            value="open"
            checked={signUpMode === "open"}
            onChange={() => setSignUpMode("open")}
          />
          Open: new users are active right away
        </label>
      </fieldset>

      <label htmlFor="contact">
        Contact (for reports and account questions)
      </label>
      <input
        id="contact"
        placeholder="support@example.com or https://example.com/contact"
        value={contact}
        maxLength={CONTACT_MAX_LENGTH}
        onChange={(event) => setContact(event.target.value)}
      />
      {contactError && <p role="alert">{contactError}</p>}

      <fieldset>
        <legend>Footer links (up to {FOOTER_LINKS_MAX_COUNT})</legend>
        {footerLinks.map((link) => (
          <div key={link.key}>
            <label htmlFor={`footer-link-label-${link.key}`}>Label</label>
            <input
              id={`footer-link-label-${link.key}`}
              value={link.label}
              maxLength={FOOTER_LINK_LABEL_MAX_LENGTH}
              onChange={(event) =>
                setFooterLinks(
                  footerLinks.map((item) =>
                    item.key === link.key
                      ? { ...item, label: event.target.value }
                      : item,
                  ),
                )
              }
            />
            <label htmlFor={`footer-link-url-${link.key}`}>URL</label>
            <input
              id={`footer-link-url-${link.key}`}
              placeholder="https://example.com/imprint"
              value={link.url}
              onChange={(event) =>
                setFooterLinks(
                  footerLinks.map((item) =>
                    item.key === link.key
                      ? { ...item, url: event.target.value }
                      : item,
                  ),
                )
              }
            />
            <button
              type="button"
              onClick={() =>
                setFooterLinks(
                  footerLinks.filter((item) => item.key !== link.key),
                )
              }
            >
              Remove
            </button>
          </div>
        ))}
        {footerLinksError && <p role="alert">{footerLinksError}</p>}
        {footerLinks.length < FOOTER_LINKS_MAX_COUNT && (
          <button
            type="button"
            onClick={() => {
              setFooterLinks([
                ...footerLinks,
                { key: nextFooterLinkKey, label: "", url: "" },
              ]);
              setNextFooterLinkKey(nextFooterLinkKey + 1);
            }}
          >
            Add a footer link
          </button>
        )}
      </fieldset>

      <label htmlFor="logo">
        Logo (also the favicon; PNG, JPEG or WebP, ≤ 1 MB)
      </label>
      <input
        id="logo"
        type="file"
        accept="image/png,image/jpeg,image/webp"
        onChange={(event) => setLogoFile(event.target.files?.[0] ?? null)}
      />
      {logoError && <p role="alert">{logoError}</p>}
      {settings.logo && !logoFile && (
        <img src="/api/site-settings/logo" alt="Current logo" width={48} />
      )}

      <label htmlFor="background">
        Background image (PNG, JPEG or WebP, ≤ 5 MB)
      </label>
      <input
        id="background"
        type="file"
        accept="image/png,image/jpeg,image/webp"
        onChange={(event) => setBackgroundFile(event.target.files?.[0] ?? null)}
      />
      {backgroundError && <p role="alert">{backgroundError}</p>}
      {settings.background && !backgroundFile && (
        <img
          src="/api/site-settings/background"
          alt="Current background"
          width={96}
        />
      )}

      <button
        type="submit"
        disabled={!canSave || saveState.status === "saving"}
      >
        Save
      </button>
      {saveState.status === "error" && <p role="alert">{saveState.message}</p>}
      {saveState.status === "saved" && <p>Saved.</p>}
    </form>
  );
}
