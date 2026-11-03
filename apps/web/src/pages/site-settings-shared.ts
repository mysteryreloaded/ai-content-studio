import type { FooterLink, SignUpMode } from "@ai-content-studio/shared";

/** The one GET /api/admin/site-settings response (issue #201): shared by `SiteSettingsPage` and every section form so it's fetched once. */
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
  termsBody: string;
  termsVersion: number | null;
  termsVersionCreatedAt: string | null;
  termsRevision: number;
  privacyBody: string;
  privacyUpdatedAt: string | null;
  privacyRevision: number;
  blockedWords: string[];
  blockedWordsRevision: number;
  notice: string;
  noticeRevision: number;
  paused: boolean;
  pausedAt: string | null;
  pausedByName: string | null;
  dailyCap: number;
  concurrentCap: number;
  capsRevision: number;
}

export const siteSettingsQueryKey = ["admin", "site-settings"] as const;
