import { cn } from "cn";
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

/** Issue #223's Model-card grid: 1 column on phones, 2 from 768px, 3 from 1200px, 24px gaps. */
const CARD_GRID_CLASS =
  "grid grid-cols-1 gap-6 md:grid-cols-2 min-[1200px]:grid-cols-3";

/** The quiet line under the hero's sign-in button (issue #223). */
function signInNote(signUpMode: "open" | "approval"): string {
  return signUpMode === "approval"
    ? "An Admin approves new accounts"
    : "Sign in with Google to start";
}

interface HowItWorksStep {
  title: string;
  body: string;
}

function howItWorksSteps(signUpMode: "open" | "approval"): HowItWorksStep[] {
  return [
    {
      title: "Sign in with Google",
      body:
        signUpMode === "approval"
          ? "Sign in with Google and wait for an Admin to approve you."
          : "Sign in with Google.",
    },
    {
      title: "Pick a Model",
      body: "Pick a Model and describe what you want.",
    },
    {
      title: "Watch it render",
      body: "Watch it render, then download it from your Gallery.",
    },
  ];
}

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
  // background/foreground (spec #33/#24, injected by the server). With one,
  // a gradient scrim sits over it (issue #223) so white hero text keeps AA
  // contrast regardless of the image or the accent.
  const hasBackground = Boolean(settings?.hasBackground);
  const backgroundStyle: CSSProperties = hasBackground
    ? {
        backgroundImage: "url(/api/site-settings/background)",
        backgroundSize: "cover",
        backgroundPosition: "center",
      }
    : {};

  const signUpMode = settings?.signUpMode ?? "open";

  return (
    <main className="flex flex-col gap-sections">
      <header
        style={backgroundStyle}
        className={cn(
          "relative flex flex-col items-center justify-center gap-content overflow-hidden rounded-[10px] px-4 py-16 text-center sm:px-8 lg:min-h-[60vh]",
          hasBackground
            ? "text-white"
            : "bg-[var(--landing-background)] text-[var(--landing-foreground)]",
        )}
      >
        {hasBackground && (
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-gradient-to-b from-black/60 to-black/80"
          />
        )}
        <div className="relative z-10 flex w-full max-w-xl flex-col items-center gap-content">
          {settings?.hasLogo && (
            <img src="/api/site-settings/logo" alt="" width={64} height={64} />
          )}
          <h1 className="text-[36px] leading-[1.1] lg:text-[52px]">{title}</h1>
          {landingText && (
            <p className="max-w-[60ch] text-[19px] leading-snug">
              {landingText}
            </p>
          )}
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
          <div className="flex flex-col items-center gap-2">
            <GoogleSignInButton href={signInHref()} size="lg" />
            <p
              className={cn(
                "text-sm",
                hasBackground ? "text-white" : "text-muted-foreground",
              )}
            >
              {signInNote(signUpMode)}
            </p>
          </div>
        </div>
      </header>

      {isError && (
        <p className="text-muted-foreground">could not load Models</p>
      )}

      {!isError && models.length > 0 && (
        <div className="flex flex-col gap-content">
          <div className="flex flex-col gap-1.5 text-center">
            <h2>What you can make</h2>
            <p className="text-muted-foreground">
              Every Model the Operator has turned on, ready to run.
            </p>
          </div>
          <section aria-label="Models" className={CARD_GRID_CLASS}>
            {models.map((model) => (
              <ModelCard
                key={model.id}
                href={signInHref(`/models/${model.slug}`)}
                model={model}
              />
            ))}
          </section>
        </div>
      )}

      <section className="flex flex-col gap-content">
        <h2 className="text-center">How it works</h2>
        <div className="grid grid-cols-1 gap-content md:grid-cols-3">
          {howItWorksSteps(signUpMode).map((step, index) => (
            <div
              key={step.title}
              className="flex flex-col items-center gap-2 text-center"
            >
              <span className="flex size-10 items-center justify-center rounded-full bg-primary font-heading text-lg font-semibold text-primary-foreground">
                {index + 1}
              </span>
              <h3>{step.title}</h3>
              <p className="text-muted-foreground">{step.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="flex flex-col items-center gap-content rounded-[10px] bg-secondary px-4 py-12 text-center">
        <p className="text-lg">
          Sign in to start making something with {title}.
        </p>
        <GoogleSignInButton href={signInHref()} size="lg" />
      </section>
    </main>
  );
}
