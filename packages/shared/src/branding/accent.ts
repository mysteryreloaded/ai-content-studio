/**
 * The eight tuned accent palettes a Site settings' accent colour is
 * picked from (Teal is the default). Each palette carries its own
 * light/dark pair for both the accent-on-background text (buttons,
 * links, focus rings) and the default landing page body, pre-tuned to
 * pass WCAG AA: on-accent text against the accent >= 4.5:1, the accent
 * against the page >= 4.5:1 as link text and >= 3:1 as a focus ring
 * (see accent.test.ts, the pure contrast and hue checks).
 *
 * The order is the agreed one: Teal, Green, Blue, Indigo, Violet,
 * Fuchsia, Orange, Graphite. Red and Yellow are left out on purpose
 * because they mean error and warning, so Fuchsia is tuned to sit
 * >= 20 degrees away from the state tokens' hues. Orange sits at
 * hue ~22 degrees: no real orange can be 20 degrees from both the
 * err token (~5 degrees) and the warn token (~39 degrees), so it gets
 * a 15 degree floor from each of them instead (see accent.test.ts).
 */
export interface AccentPalette {
  key: string;
  label: string;
  light: {
    /** Interactive elements' background/border colour. */
    accent: string;
    /** Text/icon colour placed on top of `accent`. */
    onAccent: string;
    /** The default landing page background when no image is set. */
    background: string;
    /** Body text colour on `background`. */
    foreground: string;
  };
  dark: {
    accent: string;
    onAccent: string;
    background: string;
    foreground: string;
  };
}

export const ACCENT_PALETTES: readonly AccentPalette[] = [
  {
    key: "teal",
    label: "Teal",
    light: {
      accent: "#0f766e",
      onAccent: "#ffffff",
      background: "#f4faf9",
      foreground: "#0b3b36",
    },
    dark: {
      accent: "#2dd4bf",
      onAccent: "#0b0b0c",
      background: "#07211d",
      foreground: "#ccfbf1",
    },
  },
  {
    key: "green",
    label: "Green",
    light: {
      accent: "#166534",
      onAccent: "#ffffff",
      background: "#f0fdf4",
      foreground: "#052e16",
    },
    dark: {
      accent: "#4ade80",
      onAccent: "#0b0b0c",
      background: "#052e16",
      foreground: "#dcfce7",
    },
  },
  {
    key: "blue",
    label: "Blue",
    light: {
      accent: "#1d4ed8",
      onAccent: "#ffffff",
      background: "#eff6ff",
      foreground: "#1e3a8a",
    },
    dark: {
      accent: "#60a5fa",
      onAccent: "#0b0b0c",
      background: "#172554",
      foreground: "#dbeafe",
    },
  },
  {
    key: "indigo",
    label: "Indigo",
    light: {
      accent: "#4338ca",
      onAccent: "#ffffff",
      background: "#f5f5ff",
      foreground: "#1e1b4b",
    },
    dark: {
      accent: "#818cf8",
      onAccent: "#0b0b0c",
      background: "#161132",
      foreground: "#e0e7ff",
    },
  },
  {
    key: "violet",
    label: "Violet",
    light: {
      accent: "#6d28d9",
      onAccent: "#ffffff",
      background: "#f8f5ff",
      foreground: "#2e1065",
    },
    dark: {
      accent: "#a78bfa",
      onAccent: "#0b0b0c",
      background: "#1e1033",
      foreground: "#ede9fe",
    },
  },
  {
    key: "fuchsia",
    label: "Fuchsia",
    light: {
      accent: "#a21caf",
      onAccent: "#ffffff",
      background: "#fdf2f8",
      foreground: "#701a75",
    },
    dark: {
      accent: "#e879f9",
      onAccent: "#0b0b0c",
      background: "#290a24",
      foreground: "#f0abfc",
    },
  },
  {
    key: "orange",
    label: "Orange",
    light: {
      accent: "#b84a0a",
      onAccent: "#ffffff",
      background: "#fff7ed",
      foreground: "#431407",
    },
    dark: {
      accent: "#fb8c4a",
      onAccent: "#0b0b0c",
      background: "#261105",
      foreground: "#ffedd5",
    },
  },
  {
    key: "graphite",
    label: "Graphite",
    light: {
      accent: "#374151",
      onAccent: "#ffffff",
      background: "#f4f5f6",
      foreground: "#111827",
    },
    dark: {
      accent: "#d1d5db",
      onAccent: "#0b0b0c",
      background: "#101315",
      foreground: "#e5e7eb",
    },
  },
] as const;

export const DEFAULT_ACCENT_KEY = "teal";

export const ACCENT_KEYS: readonly string[] = ACCENT_PALETTES.map(
  (palette) => palette.key,
);

export function findAccentPalette(key: string): AccentPalette | undefined {
  return ACCENT_PALETTES.find((palette) => palette.key === key);
}

/** Relative luminance (WCAG 2.x), `hex` as `#rrggbb`. */
export function relativeLuminance(hex: string): number {
  const channel = (value: number): number => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const r = Number.parseInt(hex.slice(1, 3), 16);
  const g = Number.parseInt(hex.slice(3, 5), 16);
  const b = Number.parseInt(hex.slice(5, 7), 16);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG contrast ratio between two `#rrggbb` colours, >= 1. */
export function contrastRatio(a: string, b: string): number {
  const l1 = relativeLuminance(a);
  const l2 = relativeLuminance(b);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Hue in degrees (0-360) of a `#rrggbb` colour; 0 for an achromatic
 * one. The short way around the circle between two hues is
 * `Math.min(Math.abs(a - b), 360 - Math.abs(a - b))`.
 */
export function hueOf(hex: string): number {
  const r = Number.parseInt(hex.slice(1, 3), 16);
  const g = Number.parseInt(hex.slice(3, 5), 16);
  const b = Number.parseInt(hex.slice(5, 7), 16);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  if (delta === 0) return 0;
  let hue: number;
  if (max === r) {
    hue = (((g - b) / delta) % 6) * 60;
  } else if (max === g) {
    hue = ((b - r) / delta + 2) * 60;
  } else {
    hue = ((r - g) / delta + 4) * 60;
  }
  return (hue + 360) % 360;
}

export const WCAG_AA_CONTRAST = 4.5;

/** WCAG 2.x non-text contrast (a focus ring against its background). */
export const WCAG_AA_NON_TEXT_CONTRAST = 3;
