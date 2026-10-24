import { describe, expect, test } from "bun:test";
import { ACCENT_PALETTES, WCAG_AA_CONTRAST, contrastRatio } from "./accent.js";

describe("every accent palette's light/dark pair passes WCAG AA", () => {
  for (const palette of ACCENT_PALETTES) {
    for (const mode of ["light", "dark"] as const) {
      const pair = palette[mode];

      test(`${palette.key} (${mode}): onAccent vs accent`, () => {
        expect(
          contrastRatio(pair.onAccent, pair.accent),
        ).toBeGreaterThanOrEqual(WCAG_AA_CONTRAST);
      });

      test(`${palette.key} (${mode}): foreground vs background`, () => {
        expect(
          contrastRatio(pair.foreground, pair.background),
        ).toBeGreaterThanOrEqual(WCAG_AA_CONTRAST);
      });
    }
  }
});
