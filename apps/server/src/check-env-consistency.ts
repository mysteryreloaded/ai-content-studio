#!/usr/bin/env bun
import { readFileSync } from "node:fs";
import path from "node:path";
import { ENV_KEYS } from "./env.js";

/** Fails if `.env.example` and the zod schema in `env.ts` list different keys. */
function main() {
  const examplePath = path.join(import.meta.dir, "..", ".env.example");
  const exampleKeys = readFileSync(examplePath, "utf-8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => line.split("=")[0] ?? "");

  const schemaKeys = new Set(ENV_KEYS);
  const exampleKeySet = new Set(exampleKeys);

  const missingFromExample = ENV_KEYS.filter((key) => !exampleKeySet.has(key));
  const extraInExample = exampleKeys.filter((key) => !schemaKeys.has(key));

  if (missingFromExample.length > 0 || extraInExample.length > 0) {
    if (missingFromExample.length > 0) {
      console.error(
        `.env.example is missing: ${missingFromExample.join(", ")}`,
      );
    }
    if (extraInExample.length > 0) {
      console.error(
        `.env.example has keys not in the schema: ${extraInExample.join(", ")}`,
      );
    }
    process.exit(1);
  }

  console.log(".env.example matches the env schema");
}

main();
