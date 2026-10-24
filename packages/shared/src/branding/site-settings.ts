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

/** Issue #62: whether signing in needs an Admin's approval. Switching this approves nobody already pending. */
export const SIGN_UP_MODES = ["open", "approval"] as const;
export type SignUpMode = (typeof SIGN_UP_MODES)[number];
export const DEFAULT_SIGN_UP_MODE: SignUpMode = "approval";

/** The contact shown on the waiting page, for reports and account questions: an email or an http(s) URL. */
export const CONTACT_MAX_LENGTH = 200;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidContact(value: string): boolean {
  if (value === "") return true;
  if (EMAIL_RE.test(value)) return true;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export const siteSettingsFieldsSchema = z.object({
  title: z.string().trim().min(1).max(TITLE_MAX_LENGTH),
  landingText: z.string().trim().max(LANDING_TEXT_MAX_LENGTH).default(""),
  accent: z
    .enum(ACCENT_KEYS as [string, ...string[]])
    .default(DEFAULT_ACCENT_KEY),
  signUpMode: z.enum(SIGN_UP_MODES).default(DEFAULT_SIGN_UP_MODE),
  contact: z
    .string()
    .trim()
    .max(CONTACT_MAX_LENGTH)
    .default("")
    .refine(isValidContact, {
      message: "must be an email address or an http(s) URL",
    }),
});

export type SiteSettingsFields = z.infer<typeof siteSettingsFieldsSchema>;

/** Site terms (issue #60): a blank body means "no terms set", not a 0-length version. */
export const TERMS_MAX_LENGTH = 50_000;

export const siteTermsFieldsSchema = z.object({
  body: z.string().max(TERMS_MAX_LENGTH),
  askAgain: z.boolean().default(false),
});

export type SiteTermsFields = z.infer<typeof siteTermsFieldsSchema>;

export function maxBytesFor(key: "logo" | "background"): number {
  return key === "logo" ? LOGO_MAX_BYTES : BACKGROUND_MAX_BYTES;
}

export function isAllowedImageContentType(contentType: string): boolean {
  return (ALLOWED_IMAGE_CONTENT_TYPES as readonly string[]).includes(
    contentType,
  );
}
