import { describe, expect, test } from "bun:test";
import { EnvValidationError, loadEnv } from "./env.js";

describe("loadEnv", () => {
  test("parses a valid environment, applying defaults", () => {
    const env = loadEnv({ DATABASE_URL: "postgres://localhost:5432/db" });
    expect(env.DATABASE_URL).toBe("postgres://localhost:5432/db");
    expect(env.PORT).toBe(3000);
    expect(env.LOG_LEVEL).toBe("info");
  });

  test("lists every failing variable with its docs section", () => {
    expect.assertions(2);
    try {
      loadEnv({ DATABASE_URL: "not-a-url", LOG_LEVEL: "verbose" });
    } catch (error) {
      expect(error).toBeInstanceOf(EnvValidationError);
      const issues = (error as EnvValidationError).issues;
      expect(issues).toEqual([
        expect.stringContaining("docs/server-env.md#database_url"),
        expect.stringContaining("docs/server-env.md#log_level"),
      ]);
    }
  });
});
