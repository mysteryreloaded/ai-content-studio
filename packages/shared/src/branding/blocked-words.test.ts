import { describe, expect, test } from "bun:test";
import {
  BLOCKED_WORDS_MAX_ENTRIES,
  BLOCKED_WORDS_MAX_ENTRY_LENGTH,
  findBlockedWord,
  normalizeBlockedWord,
  parseBlockedWordsList,
  validateBlockedWordsList,
} from "./blocked-words.js";

describe("parseBlockedWordsList", () => {
  test("splits lines, trims, case-folds and drops blanks", () => {
    expect(parseBlockedWordsList("Foo\n  bar  \n\nBAZ qux\n")).toEqual([
      "foo",
      "bar",
      "baz qux",
    ]);
  });

  test("dedupes, keeping the first occurrence's position", () => {
    expect(parseBlockedWordsList("Foo\nbar\nFOO")).toEqual(["foo", "bar"]);
  });

  test("NFKC-normalises so a full-width or precomposed variant matches the plain word", () => {
    // "ｆｏｏ" (fullwidth) normalises to "foo" under NFKC.
    expect(parseBlockedWordsList("ｆｏｏ\nfoo")).toEqual(["foo"]);
  });
});

describe("normalizeBlockedWord", () => {
  test("case-folds and NFKC-normalises", () => {
    expect(normalizeBlockedWord("  Café  ")).toBe("café");
  });
});

describe("validateBlockedWordsList", () => {
  test("accepts a list within the limits", () => {
    expect(validateBlockedWordsList(["foo", "bar"])).toBeNull();
  });

  test("refuses more than the max entries", () => {
    const words = Array.from(
      { length: BLOCKED_WORDS_MAX_ENTRIES + 1 },
      (_, i) => `word${i}`,
    );
    expect(validateBlockedWordsList(words)).toContain("1000 entries");
  });

  test("refuses an entry longer than the max length", () => {
    const tooLong = "a".repeat(BLOCKED_WORDS_MAX_ENTRY_LENGTH + 1);
    expect(validateBlockedWordsList([tooLong])).toContain("100 characters");
  });
});

describe("findBlockedWord", () => {
  test("matches a whole word, case-insensitively", () => {
    expect(findBlockedWord("a FORBIDDEN cat", ["forbidden"])).toBe("forbidden");
  });

  test("doesn't match a substring of a longer word", () => {
    expect(findBlockedWord("forbiddenware", ["forbidden"])).toBeNull();
  });

  test("matches a phrase as written, boundary-checked only at its ends", () => {
    expect(findBlockedWord("a big bad wolf story", ["bad wolf"])).toBe(
      "bad wolf",
    );
    expect(findBlockedWord("a bigbad wolfish tale", ["bad wolf"])).toBeNull();
  });

  test("uses Unicode (not ASCII-only) word boundaries", () => {
    expect(findBlockedWord("café society", ["café"])).toBe("café");
    expect(findBlockedWord("cafétéria", ["café"])).toBeNull();
  });

  test("returns null when nothing matches, or the list is empty", () => {
    expect(findBlockedWord("a lovely cat", ["forbidden"])).toBeNull();
    expect(findBlockedWord("anything", [])).toBeNull();
  });
});
