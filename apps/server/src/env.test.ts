import { describe, expect, test } from "bun:test";
import { EnvValidationError, loadEnv } from "./env.js";

const BASE_ENV = {
  DATABASE_URL: "postgres://localhost:5432/db",
  PUBLIC_URL: "http://localhost:3000",
  GOOGLE_CLIENT_ID: "client-id",
  GOOGLE_CLIENT_SECRET: "client-secret",
  ADMIN_EMAILS: "admin@example.com",
  SECRET_KEY: "4FRG13w9RuN5CeV10Lzfxl78MY+AJRJtGuKrBdYzgCY=",
};

describe("loadEnv", () => {
  test("parses a valid environment, applying defaults", () => {
    const env = loadEnv(BASE_ENV);
    expect(env.DATABASE_URL).toBe("postgres://localhost:5432/db");
    expect(env.PORT).toBe(3000);
    expect(env.LOG_LEVEL).toBe("info");
    expect(env.ADMIN_EMAILS).toEqual(["admin@example.com"]);
    expect(env.MAX_UPLOAD_MB).toBe(500);
  });

  test("lowercases and splits ADMIN_EMAILS", () => {
    const env = loadEnv({
      ...BASE_ENV,
      ADMIN_EMAILS: "Admin@Example.com, Other@Example.com",
    });
    expect(env.ADMIN_EMAILS).toEqual([
      "admin@example.com",
      "other@example.com",
    ]);
  });

  test("lists every failing variable with its docs section", () => {
    expect.assertions(2);
    try {
      loadEnv({ ...BASE_ENV, DATABASE_URL: "not-a-url", LOG_LEVEL: "verbose" });
    } catch (error) {
      expect(error).toBeInstanceOf(EnvValidationError);
      const issues = (error as EnvValidationError).issues;
      expect(issues).toEqual([
        expect.stringContaining("docs/server-env.md#database_url"),
        expect.stringContaining("docs/server-env.md#log_level"),
      ]);
    }
  });

  test("rejects an empty ADMIN_EMAILS", () => {
    expect.assertions(1);
    try {
      loadEnv({ ...BASE_ENV, ADMIN_EMAILS: "" });
    } catch (error) {
      expect(error).toBeInstanceOf(EnvValidationError);
    }
  });

  test("refuses OIDC_ISSUER unless PUBLIC_URL is localhost", () => {
    expect.assertions(1);
    try {
      loadEnv({
        ...BASE_ENV,
        PUBLIC_URL: "https://studio.example.com",
        OIDC_ISSUER: "http://localhost:4000",
      });
    } catch (error) {
      expect(error).toBeInstanceOf(EnvValidationError);
    }
  });

  test("allows OIDC_ISSUER when PUBLIC_URL is localhost", () => {
    const env = loadEnv({
      ...BASE_ENV,
      PUBLIC_URL: "http://localhost:3000",
      OIDC_ISSUER: "http://localhost:4000",
    });
    expect(env.OIDC_ISSUER).toBe("http://localhost:4000");
  });
});
