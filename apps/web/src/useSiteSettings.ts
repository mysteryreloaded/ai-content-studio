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
      .then((res) => {
        if (!res.ok) throw new Error(`unexpected status ${res.status}`);
        return res.json() as Promise<PublicSiteSettings>;
      })
      .then((data) => {
        if (!cancelled) setSettings(data);
      })
      .catch(() => {
        /* leave it null rather than show a wrong default, or the
           {"error": ...} body from a 500 (issue #65 QA round 3) */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return settings;
}
