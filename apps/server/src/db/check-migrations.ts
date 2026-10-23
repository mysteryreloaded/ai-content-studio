#!/usr/bin/env bun
import { $ } from "bun";

/**
 * Fails if `src/db/schema.ts` has changes that `drizzle-kit generate`
 * hasn't turned into a committed migration yet.
 */
async function main() {
  const before = await $`git status --porcelain drizzle/migrations`.text();
  await $`bunx drizzle-kit generate`.quiet();
  const after = await $`git status --porcelain drizzle/migrations`.text();

  if (before !== after) {
    console.error(
      "drizzle/migrations is out of date with src/db/schema.ts.\n" +
        "Run `bun run db:generate` in apps/server and commit the result.",
    );
    process.exit(1);
  }

  console.log("migrations are up to date with the schema");
}

main();
