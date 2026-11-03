import type { FooterLink, SignUpMode } from "@ai-content-studio/shared";

/** The one GET /api/admin/site-settings response (issue #201): shared by `SiteSettingsPage`, `SiteSettingsForm` and `CapsForm` so it's fetched once. */
export interface ImageSnapshot {
  contentType: string;
  hash: string;
  size: number;
}

export interface AdminSiteSettings {
  version: number;
  title: string;
  landingText: string;
  accent: string;
  signUpMode: SignUpMode;
  contact: string;
  footerLinks: FooterLink[];
  logo: ImageSnapshot | null;
  background: ImageSnapshot | null;
  dailyCap: number;
  concurrentCap: number;
  capsRevision: number;
}

export const siteSettingsQueryKey = ["admin", "site-settings"] as const;
