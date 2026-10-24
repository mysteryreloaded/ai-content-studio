import { z } from "zod";

/** Section of docs/server-env.md explaining each variable, by key. */
const DOCS_BY_KEY: Record<string, string> = {
  DATABASE_URL: "docs/server-env.md#database_url",
  PORT: "docs/server-env.md#port",
  LOG_LEVEL: "docs/server-env.md#log_level",
  PUBLIC_URL: "docs/server-env.md#public_url",
  GOOGLE_CLIENT_ID: "docs/server-env.md#google_client_id",
  GOOGLE_CLIENT_SECRET: "docs/server-env.md#google_client_secret",
  ADMIN_EMAILS: "docs/server-env.md#admin_emails",
  OIDC_ISSUER: "docs/server-env.md#oidc_issuer",
  DATA_DIR: "docs/server-env.md#data_dir",
  SECRET_KEY: "docs/server-env.md#secret_key",
  BACKENDS_ENABLED: "docs/server-env.md#backends_enabled",
  STATUS_TOKEN: "docs/server-env.md#status_token",
  MIN_FREE_DISK_GB: "docs/server-env.md#min_free_disk_gb",
  MAX_UPLOAD_MB: "docs/server-env.md#max_upload_mb",
};

function isLocalhost(url: string): boolean {
  try {
    const hostname = new URL(url).hostname;
    return hostname === "localhost" || hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

const envSchema = z
  .object({
    DATABASE_URL: z.string().min(1).url(),
    PORT: z.coerce.number().int().positive().default(3000),
    LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
    PUBLIC_URL: z.string().min(1).url(),
    GOOGLE_CLIENT_ID: z.string().min(1),
    GOOGLE_CLIENT_SECRET: z.string().min(1),
    ADMIN_EMAILS: z
      .string()
      .min(1)
      .transform((value) =>
        value
          .split(",")
          .map((email) => email.trim().toLowerCase())
          .filter((email) => email.length > 0),
      )
      .refine((emails) => emails.length > 0, {
        message: "must list at least one email",
      }),
    OIDC_ISSUER: z.string().min(1).url().optional(),
    DATA_DIR: z.string().min(1).default("/data"),
    SECRET_KEY: z
      .string()
      .min(1)
      .refine((value) => Buffer.from(value, "base64").length === 32, {
        message: "must be base64 for 32 bytes (AES-256-GCM key)",
      }),
    BACKENDS_ENABLED: z
      .enum(["true", "false"])
      .default("true")
      .transform((value) => value === "true"),
    STATUS_TOKEN: z.string().min(1).optional(),
    MIN_FREE_DISK_GB: z.coerce.number().positive().default(10),
    MAX_UPLOAD_MB: z.coerce.number().int().positive().default(500),
  })
  .superRefine((value, ctx) => {
    if (value.OIDC_ISSUER && !isLocalhost(value.PUBLIC_URL)) {
      ctx.addIssue({
        code: "custom",
        path: ["OIDC_ISSUER"],
        message: "may only be set when PUBLIC_URL is localhost",
      });
    }
  });

/** Every env var key the schema checks, for the `.env.example` consistency check. */
export const ENV_KEYS: readonly string[] = [
  "DATABASE_URL",
  "PORT",
  "LOG_LEVEL",
  "PUBLIC_URL",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "ADMIN_EMAILS",
  "OIDC_ISSUER",
  "DATA_DIR",
  "SECRET_KEY",
  "BACKENDS_ENABLED",
  "STATUS_TOKEN",
  "MIN_FREE_DISK_GB",
  "MAX_UPLOAD_MB",
];

export type Env = z.infer<typeof envSchema>;

export class EnvValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid environment:\n${issues.join("\n")}`);
    this.name = "EnvValidationError";
  }
}

/** Parses `process.env` against the schema above, throwing with every error listed. */
export function loadEnv(
  source: Record<string, string | undefined> = process.env,
): Env {
  const result = envSchema.safeParse(source);
  if (result.success) return result.data;

  const issues = result.error.issues.map((issue) => {
    const key = String(issue.path[0] ?? "");
    const docs = DOCS_BY_KEY[key] ?? "docs/server-env.md";
    return `  - ${key}: ${issue.message} (see ${docs})`;
  });
  throw new EnvValidationError(issues);
}
