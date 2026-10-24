import type { FooterLink, SignUpMode } from "@ai-content-studio/shared";
import { useEffect, useState } from "react";

export interface PublicSiteSettings {
  title: string;
  landingText: string;
  accent: string;
  signUpMode: SignUpMode;
  contact: string;
  hasLogo: boolean;
  hasBackground: boolean;
  hasTerms: boolean;
  footerLinks: FooterLink[];
  hasNonVideoEnabledModel: boolean;
}

/** The public branding `/api/site-settings` returns. Works signed out, and before the Site terms gate. */
export function useSiteSettings(): PublicSiteSettings | null {
  const [settings, setSettings] = useState<PublicSiteSettings | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/site-settings")
      .then((res) => res.json() as Promise<PublicSiteSettings>)
      .then((data) => {
        if (!cancelled) setSettings(data);
      })
      .catch(() => {
        /* leave it null rather than show a wrong default */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return settings;
}
