import { type CSSProperties, useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { useSession } from "./useSession.js";

interface SiteSettings {
  title: string;
  landingText: string;
  hasBackground: boolean;
}

const AUTH_ERROR_MESSAGES: Record<string, string> = {
  cancelled: "Sign-in was cancelled.",
  failed: "Sign-in didn't complete. Please try again.",
  unverified:
    "That Google account's email isn't verified, so it can't sign in.",
};

export function LandingPage() {
  const [settings, setSettings] = useState<SiteSettings | null>(null);
  const { session } = useSession();

  useEffect(() => {
    fetch("/api/site-settings")
      .then((res) => res.json())
      .then(setSettings)
      .catch(() => setSettings(null));
  }, []);

  const authError = new URLSearchParams(window.location.search).get(
    "auth_error",
  );
  const bannerMessage = authError ? AUTH_ERROR_MESSAGES[authError] : undefined;

  if (session.status === "signed-in") {
    return <Navigate to="/models" replace />;
  }

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
    <main style={backgroundStyle}>
      <h1>{settings?.title ?? "AI Content Studio"}</h1>
      {settings?.landingText && <p>{settings.landingText}</p>}
      {bannerMessage && <p role="alert">{bannerMessage}</p>}
      <a href="/api/auth/google">Sign in with Google</a>
    </main>
  );
}
