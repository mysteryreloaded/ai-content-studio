import { type CSSProperties, useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { Footer } from "./Footer.js";
import { GoogleSignInButton } from "./GoogleSignInButton.js";
import { useSession } from "./useSession.js";
import { useSiteSettings } from "./useSiteSettings.js";

interface EnabledModel {
  id: string;
  slug: string;
  name: string;
  description: string;
  modeCount: number;
  attribution: string;
}

const AUTH_ERROR_MESSAGES: Record<string, string> = {
  cancelled: "Sign-in was cancelled.",
  failed: "Sign-in didn't complete. Please try again.",
  unverified:
    "That Google account's email isn't verified, so it can't sign in.",
};

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

export function LandingPage() {
  const settings = useSiteSettings();
  const { session } = useSession();
  const [models, setModels] = useState<EnabledModel[] | null>(null);

  useEffect(() => {
    fetch("/api/models")
      .then((res) => res.json() as Promise<{ models: EnabledModel[] }>)
      .then((body) => setModels(body.models))
      .catch(() => setModels(null));
  }, []);

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

  const backgroundStyle: CSSProperties = settings?.hasBackground
    ? {
        backgroundImage: "url(/api/site-settings/background)",
        backgroundSize: "cover",
      }
    : {
        background: "var(--landing-background)",
        color: "var(--landing-foreground)",
      };

  return (
    <>
      <main style={backgroundStyle}>
        {settings?.hasLogo && (
          <img src="/api/site-settings/logo" alt="" width={64} height={64} />
        )}
        <h1>{title}</h1>
        {landingText && <p>{landingText}</p>}
        {bannerMessage && <p role="alert">{bannerMessage}</p>}
        <GoogleSignInButton href={signInHref()} />

        {models && models.length > 0 && (
          <section aria-label="Models">
            {models.map((model) => (
              <article key={model.id}>
                <h2>
                  <a href={signInHref(`/models/${model.slug}`)}>{model.name}</a>
                </h2>
                {model.description && <p>{model.description}</p>}
                {model.attribution && <p>{model.attribution}</p>}
              </article>
            ))}
          </section>
        )}
      </main>
      <Footer />
    </>
  );
}
