import type { CSSProperties } from "react";
import { Navigate } from "react-router-dom";
import { GoogleSignInButton } from "./GoogleSignInButton.js";
import { ModelCard } from "./components/ModelCard.js";
import { Alert, AlertDescription, AlertTitle } from "./components/ui/alert.js";
import { useEnabledModels } from "./lib/models.js";
import { useSession } from "./useSession.js";
import { useSiteSettings } from "./useSiteSettings.js";

const AUTH_ERROR_MESSAGES: Record<string, string> = {
  cancelled: "Sign-in was cancelled.",
  failed: "Sign-in didn't complete. Please try again.",
  unverified:
    "That Google account's email isn't verified, so it can't sign in.",
  disabled: "This account has been disabled.",
  blocked: "This account can't sign in.",
};

function contactHref(contact: string): string {
  return contact.startsWith("http://") || contact.startsWith("https://")
    ? contact
    : `mailto:${contact}`;
}

/** Issue #65: the default landing text when the Operator hasn't written one. */
function defaultLandingText(
  title: string,
  signUpMode: "open" | "approval",
  hasNonVideoEnabledModel: boolean,
): string {
  const kind = hasNonVideoEnabledModel ? "AI models" : "AI video models";
  const action =
    signUpMode === "open"
      ? "Sign in with Google to get started."
      : "Sign in with Google to request access.";
  return `${title} runs ${kind} on its own GPUs. ${action}`;
}

function signInHref(returnTo?: string): string {
  return returnTo
    ? `/api/auth/google?return_to=${encodeURIComponent(returnTo)}`
    : "/api/auth/google";
}

/** The prototype's Model-card grid (issue #175): one card per row on phones, auto-fill to 340px above. */
const CARD_GRID_CLASS =
  "grid grid-cols-[repeat(auto-fill,minmax(min(100%,340px),1fr))] gap-sections";

export function LandingPage() {
  const settings = useSiteSettings();
  const { session } = useSession();
  // The one shared `["models"]` query (issues #175/#188), shown as cards;
  // a failed request shows an error (the old code ignored `res.ok`).
  const { models, isError } = useEnabledModels();

  const authError = new URLSearchParams(window.location.search).get(
    "auth_error",
  );
  const bannerMessage = authError ? AUTH_ERROR_MESSAGES[authError] : undefined;

  if (session.status === "signed-in") {
    return <Navigate to="/models" replace />;
  }

  const title = settings?.title ?? "AI Content Studio";
  const landingText =
    settings?.landingText ||
    (settings
      ? defaultLandingText(
          title,
          settings.signUpMode,
          settings.hasNonVideoEnabledModel,
        )
      : "");

  // The only data-driven style: the Operator's uploaded background image
  // (issue #65). Without it the hero sits on the accent's landing
  // background/foreground (spec #33/#24, injected by the server).
  const backgroundStyle: CSSProperties = settings?.hasBackground
    ? {
        backgroundImage: "url(/api/site-settings/background)",
        backgroundSize: "cover",
      }
    : {};

  return (
    <main className="flex flex-col gap-sections">
      <header
        style={backgroundStyle}
        className="flex flex-col items-center rounded-[10px] bg-[var(--landing-background)] p-8 text-center text-[var(--landing-foreground)]"
      >
        <div className="flex w-full max-w-md flex-col items-center gap-content">
          {settings?.hasLogo && (
            <img src="/api/site-settings/logo" alt="" width={64} height={64} />
          )}
          <h1>{title}</h1>
          {landingText && <p>{landingText}</p>}
          {bannerMessage && (
            <Alert variant="destructive" className="w-full">
              <AlertTitle>{bannerMessage}</AlertTitle>
              {authError === "disabled" && settings?.contact && (
                <AlertDescription>
                  Questions or reports:{" "}
                  <a href={contactHref(settings.contact)}>{settings.contact}</a>
                </AlertDescription>
              )}
            </Alert>
          )}
          <GoogleSignInButton href={signInHref()} />
        </div>
      </header>

      {isError && (
        <p className="text-muted-foreground">could not load Models</p>
      )}

      {!isError && models.length > 0 && (
        <section aria-label="Models" className={CARD_GRID_CLASS}>
          {models.map((model) => (
            <ModelCard
              key={model.id}
              href={signInHref(`/models/${model.slug}`)}
              model={model}
            />
          ))}
        </section>
      )}
    </main>
  );
}
