import { z } from "zod";

/** Model terms (issue #61): mirrors Site terms' TERMS_MAX_LENGTH. */
export const MODEL_TERMS_MAX_LENGTH = 50_000;

/** Attribution shown atop the Workbench, Models home and a Generation's detail (issue #61). */
export const MODEL_ATTRIBUTION_MAX_LENGTH = 120;

export function isValidModelLicenseUrl(value: string): boolean {
  if (value === "") return true;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export const modelTermsFieldsSchema = z.object({
  termsBody: z.string().max(MODEL_TERMS_MAX_LENGTH),
  licenseUrl: z
    .string()
    .max(2000)
    .default("")
    .refine(isValidModelLicenseUrl, { message: "must be an http(s) URL" }),
  attribution: z.string().max(MODEL_ATTRIBUTION_MAX_LENGTH).default(""),
  askAgain: z.boolean().default(false),
});

export type ModelTermsFields = z.infer<typeof modelTermsFieldsSchema>;
