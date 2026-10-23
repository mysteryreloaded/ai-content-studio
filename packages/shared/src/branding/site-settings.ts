import { z } from "zod";
import { ACCENT_KEYS, DEFAULT_ACCENT_KEY } from "./accent.js";

/** Shared between the Site settings form and the server's validation. */
export const TITLE_MAX_LENGTH = 60;
export const LANDING_TEXT_MAX_LENGTH = 300;
export const LOGO_MAX_BYTES = 1 * 1024 * 1024;
export const BACKGROUND_MAX_BYTES = 5 * 1024 * 1024;
export const ALLOWED_IMAGE_CONTENT_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
] as const;

export const siteSettingsFieldsSchema = z.object({
  title: z.string().trim().min(1).max(TITLE_MAX_LENGTH),
  landingText: z.string().trim().max(LANDING_TEXT_MAX_LENGTH).default(""),
  accent: z
    .enum(ACCENT_KEYS as [string, ...string[]])
    .default(DEFAULT_ACCENT_KEY),
});

export type SiteSettingsFields = z.infer<typeof siteSettingsFieldsSchema>;

export function maxBytesFor(key: "logo" | "background"): number {
  return key === "logo" ? LOGO_MAX_BYTES : BACKGROUND_MAX_BYTES;
}

export function isAllowedImageContentType(contentType: string): boolean {
  return (ALLOWED_IMAGE_CONTENT_TYPES as readonly string[]).includes(
    contentType,
  );
}
