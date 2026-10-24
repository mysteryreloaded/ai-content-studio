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
  FFMPEG_CONCURRENCY: "docs/server-env.md#ffmpeg_concurrency",
  C2PA_CERT_PATH: "docs/server-env.md#c2pa_cert_path",
  C2PA_KEY_PATH: "docs/server-env.md#c2pa_key_path",
  C2PA_TIMESTAMP_URL: "docs/server-env.md#c2pa_timestamp_url",
  ASSET_RETENTION_DAYS: "docs/server-env.md#asset_retention_days",
  LOG_RETENTION_DAYS: "docs/server-env.md#log_retention_days",
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
    FFMPEG_CONCURRENCY: z.coerce.number().int().positive().default(2),
    C2PA_CERT_PATH: z.string().min(1).optional(),
    C2PA_KEY_PATH: z.string().min(1).optional(),
    C2PA_TIMESTAMP_URL: z.string().min(1).url().optional(),
    /** Issue #69: blank (unset or empty) means "keep Assets forever", unlike every other numeric var here. */
    ASSET_RETENTION_DAYS: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z.coerce.number().int().positive().optional(),
    ),
    LOG_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
  })
  .superRefine((value, ctx) => {
    if (value.OIDC_ISSUER && !isLocalhost(value.PUBLIC_URL)) {
      ctx.addIssue({
        code: "custom",
        path: ["OIDC_ISSUER"],
        message: "may only be set when PUBLIC_URL is localhost",
      });
    }
    if (Boolean(value.C2PA_CERT_PATH) !== Boolean(value.C2PA_KEY_PATH)) {
      ctx.addIssue({
        code: "custom",
        path: ["C2PA_CERT_PATH"],
        message: "C2PA_CERT_PATH and C2PA_KEY_PATH must be set together",
      });
    }
    if (value.C2PA_TIMESTAMP_URL && !value.C2PA_CERT_PATH) {
      ctx.addIssue({
        code: "custom",
        path: ["C2PA_TIMESTAMP_URL"],
        message: "may only be set alongside C2PA_CERT_PATH/C2PA_KEY_PATH",
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
  "FFMPEG_CONCURRENCY",
  "C2PA_CERT_PATH",
  "C2PA_KEY_PATH",
  "C2PA_TIMESTAMP_URL",
  "ASSET_RETENTION_DAYS",
  "LOG_RETENTION_DAYS",
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
