// drizzle-orm's migrator only runs a migration whose folderMillis is
// above the last applied migration's `created_at` (pg-core/dialect.js),
// so a journal entry with a `when` at or below its predecessor's is
// silently skipped on any database that already has that predecessor.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

interface JournalEntry {
  idx: number;
  when: number;
  tag: string;
}

describe("drizzle/migrations/meta/_journal.json", () => {
  test("entries are ordered by idx and `when` strictly increases", () => {
    const journalPath = new URL(
      "../../drizzle/migrations/meta/_journal.json",
      import.meta.url,
    );
    const journal = JSON.parse(readFileSync(journalPath, "utf8")) as {
      entries: JournalEntry[];
    };
    const entries = journal.entries;
    expect(entries.length).toBeGreaterThan(0);

    for (let i = 1; i < entries.length; i++) {
      const previous = entries.at(i - 1);
      const entry = entries.at(i);
      if (!previous || !entry) throw new Error("unreachable");
      expect(entry.idx).toBe(previous.idx + 1);
      expect(entry.when).toBeGreaterThan(previous.when);
    }
  });
});
