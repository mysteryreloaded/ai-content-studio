import { z } from "zod";

/** Section of docs/server-env.md explaining each variable, by key. */
const DOCS_BY_KEY: Record<string, string> = {
  DATABASE_URL: "docs/server-env.md#database_url",
  PORT: "docs/server-env.md#port",
  LOG_LEVEL: "docs/server-env.md#log_level",
};

const envSchema = z.object({
  DATABASE_URL: z.string().min(1).url(),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

/** Every env var key the schema checks, for the `.env.example` consistency check. */
export const ENV_KEYS: readonly string[] = Object.keys(envSchema.shape);

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
