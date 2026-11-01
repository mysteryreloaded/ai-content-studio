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

/** The public branding `/api/site-settings` returns (issue #65). Works signed out, and before the Site terms gate. */
export function useSiteSettings(): PublicSiteSettings | null {
  // A failed fetch (or a 500's {"error": ...} body, issue #65 QA round 3)
  // leaves the data null rather than showing a wrong default.
  const { data } = useQuery({
    queryKey: ["site-settings"],
    queryFn: () => ok<PublicSiteSettings>(api.api["site-settings"].$get()),
  });
  return data ?? null;
}
