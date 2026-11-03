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

// Orange's floor: no real orange can sit 20° from both the err token
// (~5° in both themes) and the warn token (~39° in both themes) — the
// two zones around them cover all of hue 14°-59° — so Orange is allowed
// 15° from each of them, provided it is a real orange (hue 15°-30°) and
// not a yellow (>= 50°, which #191 reserves for warnings).
const ORANGE_HUE_SEPARATION_DEGREES = 15;
const ORANGE_HUE_RANGE_DEGREES = { min: 15, max: 30 } as const;

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
          ).toBeGreaterThanOrEqual(
            palette.key === "orange"
              ? ORANGE_HUE_SEPARATION_DEGREES
              : HUE_SEPARATION_DEGREES,
          );
        }
      });

      if (palette.key === "orange") {
        test(`${palette.key} (${mode}) accent hue is a real orange, not a yellow`, () => {
          const accentHue = hueOf(palette[mode].accent);
          expect(accentHue).toBeGreaterThanOrEqual(
            ORANGE_HUE_RANGE_DEGREES.min,
          );
          expect(accentHue).toBeLessThanOrEqual(ORANGE_HUE_RANGE_DEGREES.max);
        });
      }
    }
  }
});

// App surface values copied from apps/web/src/index.css — an accent is used
// as button/link text inside the app, where the page is --bg or a --panel
// card rather than the landing background, so it must clear both of those
// (>= 4.5:1 as text, >= 3:1 as a focus ring) in both themes.
const APP_SURFACES = {
  light: { bg: "#f4f6f5", panel: "#ffffff" },
  dark: { bg: "#101513", panel: "#171e1b" },
} as const;

describe("every accent palette's accent clears the app's own surfaces", () => {
  for (const palette of ACCENT_PALETTES) {
    for (const mode of ["light", "dark"] as const) {
      test(`${palette.key} (${mode}): accent vs --bg (link text)`, () => {
        expect(
          contrastRatio(palette[mode].accent, APP_SURFACES[mode].bg),
        ).toBeGreaterThanOrEqual(WCAG_AA_CONTRAST);
      });

      test(`${palette.key} (${mode}): accent vs --panel (link text)`, () => {
        expect(
          contrastRatio(palette[mode].accent, APP_SURFACES[mode].panel),
        ).toBeGreaterThanOrEqual(WCAG_AA_CONTRAST);
      });

      test(`${palette.key} (${mode}): accent vs --bg (focus ring)`, () => {
        expect(
          contrastRatio(palette[mode].accent, APP_SURFACES[mode].bg),
        ).toBeGreaterThanOrEqual(WCAG_AA_NON_TEXT_CONTRAST);
      });

      test(`${palette.key} (${mode}): accent vs --panel (focus ring)`, () => {
        expect(
          contrastRatio(palette[mode].accent, APP_SURFACES[mode].panel),
        ).toBeGreaterThanOrEqual(WCAG_AA_NON_TEXT_CONTRAST);
      });
    }
  }
});
