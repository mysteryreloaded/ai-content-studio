import type { FooterLink, SignUpMode } from "@ai-content-studio/shared";
import { useQuery } from "@tanstack/react-query";
import { api, ok } from "./lib/api.js";

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
  const { data } = useQuery({
    queryKey: ["site-settings"],
    queryFn: () =>
      ok<PublicSiteSettings>(api.api["site-settings"].$get()),
  });

  // Stay null rather than show a wrong default, or the {"error": ...}
  // body from a 500 (issue #65 QA round 3).
  return data ?? null;
}
