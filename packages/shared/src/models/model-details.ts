import { z } from "zod";

// Mirrors apps/server/src/models/validation.ts's `validateModelDetails`
// (issue #213): same limits, same messages, so the Details form's
// client-side zod errors read the same as the server's own 400 issues.
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export const modelDetailsSchema = z.object({
  name: z
    .string()
    .min(1, "must be 1-80 characters")
    .max(80, "must be 1-80 characters"),
  slug: z
    .string()
    .min(1, "must be 1-80 characters: lowercase letters, digits and hyphens")
    .max(80, "must be 1-80 characters: lowercase letters, digits and hyphens")
    .regex(
      SLUG_RE,
      "must be 1-80 characters: lowercase letters, digits and hyphens",
    ),
  description: z.string(),
  maxRunTimeMinutes: z
    .number()
    .int("must be 1-240")
    .min(1, "must be 1-240")
    .max(240, "must be 1-240"),
});

export type ModelDetailsFormValues = z.infer<typeof modelDetailsSchema>;
