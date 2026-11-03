import { describe, expect, test } from "bun:test";
import {
  ACCENT_PALETTES,
  WCAG_AA_CONTRAST,
  WCAG_AA_NON_TEXT_CONTRAST,
  contrastRatio,
  hueOf,
} from "./accent.js";

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

      test(`${palette.key} (${mode}): accent vs background (link text)`, () => {
        expect(
          contrastRatio(pair.accent, pair.background),
        ).toBeGreaterThanOrEqual(WCAG_AA_CONTRAST);
      });

      test(`${palette.key} (${mode}): accent vs background (focus ring)`, () => {
        expect(
          contrastRatio(pair.accent, pair.background),
        ).toBeGreaterThanOrEqual(WCAG_AA_NON_TEXT_CONTRAST);
      });
    }
  }
});

// State token values copied from apps/web/src/index.css — the accent hue must
// stay at least 20° away from them in both themes, or a link in one accent
// will read like an error/warning in another.
const STATE_TOKENS = {
  warn: { light: "#8f5c00", dark: "#f0b955" },
  err: { light: "#b9352a", dark: "#ff8577" },
} as const;

const HUE_SEPARATION_DEGREES = 20;

function circularHueDistance(a: number, b: number): number {
  const diff = Math.abs(a - b) % 360;
  return Math.min(diff, 360 - diff);
}

describe("every accent palette's hue is separated from the warn/err token hues", () => {
  for (const palette of ACCENT_PALETTES) {
    for (const mode of ["light", "dark"] as const) {
      const tokenHues = [
        hueOf(STATE_TOKENS.warn[mode]),
        hueOf(STATE_TOKENS.err[mode]),
      ];

      test(`${palette.key} (${mode}) accent hue`, () => {
        const accentHue = hueOf(palette[mode].accent);
        for (const tokenHue of tokenHues) {
          expect(
            circularHueDistance(accentHue, tokenHue),
          ).toBeGreaterThanOrEqual(HUE_SEPARATION_DEGREES);
        }
      });
    }
  }
});
