import { z } from "zod";

/**
 * Issue #66: the Admin's list of words and phrases the studio refuses in
 * prompts. One per line, NFKC-normalised, case-folded and deduped before
 * it's stored, so the same entry always compares equal however it was
 * typed.
 */
export const BLOCKED_WORDS_MAX_ENTRIES = 1_000;
export const BLOCKED_WORDS_MAX_ENTRY_LENGTH = 100;

/** The raw textarea body the admin form submits, before it's split into lines. */
export const BLOCKED_WORDS_TEXT_MAX_LENGTH =
  (BLOCKED_WORDS_MAX_ENTRIES + 1) * (BLOCKED_WORDS_MAX_ENTRY_LENGTH + 1);

export const siteBlockedWordsFieldsSchema = z.object({
  text: z.string().max(BLOCKED_WORDS_TEXT_MAX_LENGTH),
});

export type SiteBlockedWordsFields = z.infer<
  typeof siteBlockedWordsFieldsSchema
>;

/** NFKC-normalises and case-folds one entry so it compares the same however it was typed. */
export function normalizeBlockedWord(raw: string): string {
  return raw.normalize("NFKC").trim().toLowerCase();
}

/** One per line: normalised, blank lines dropped, duplicates removed (first occurrence wins). */
export function parseBlockedWordsList(text: string): string[] {
  const seen = new Set<string>();
  const words: string[] = [];
  for (const line of text.split(/\r\n|\r|\n/)) {
    const word = normalizeBlockedWord(line);
    if (word === "" || seen.has(word)) continue;
    seen.add(word);
    words.push(word);
  }
  return words;
}

/** `null` when `words` fits the list's limits, otherwise a message naming the first violation. */
export function validateBlockedWordsList(
  words: readonly string[],
): string | null {
  if (words.length > BLOCKED_WORDS_MAX_ENTRIES) {
    return `at most ${BLOCKED_WORDS_MAX_ENTRIES} entries are allowed`;
  }
  const tooLong = words.find(
    (word) => word.length > BLOCKED_WORDS_MAX_ENTRY_LENGTH,
  );
  if (tooLong) {
    return `"${tooLong}" is longer than ${BLOCKED_WORDS_MAX_ENTRY_LENGTH} characters`;
  }
  return null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const WORD_CHAR = "[\\p{L}\\p{N}_]";

/**
 * Whole-word, Unicode-boundary (not plain `\b`, which is ASCII-only),
 * case-insensitive matching: `text` is NFKC-normalised and case-folded the
 * same way `blockedWords` already were before this is called. A phrase
 * matches as written, with the same boundary check only at its two ends.
 * Returns the first matching entry, or `null`.
 */
export function findBlockedWord(
  text: string,
  blockedWords: readonly string[],
): string | null {
  if (blockedWords.length === 0) return null;
  const haystack = normalizeBlockedWord(text);
  for (const word of blockedWords) {
    const pattern = new RegExp(
      `(?<!${WORD_CHAR})${escapeRegExp(word)}(?!${WORD_CHAR})`,
      "u",
    );
    if (pattern.test(haystack)) return word;
  }
  return null;
}
