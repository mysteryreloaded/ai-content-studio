/**
 * The eight tuned accent palettes a Site settings' accent colour is
 * picked from (Teal is the default). Each palette carries its own
 * light/dark pair for both the accent-on-background text (buttons,
 * links) and the default landing page body, pre-tuned to pass WCAG AA
 * (see accent.test.ts, the pure contrast check).
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
    key: "rose",
    label: "Rose",
    light: {
      accent: "#be123c",
      onAccent: "#ffffff",
      background: "#fff5f6",
      foreground: "#4c0519",
    },
    dark: {
      accent: "#fb7185",
      onAccent: "#0b0b0c",
      background: "#2a0a10",
      foreground: "#ffe4e6",
    },
  },
  {
    key: "amber",
    label: "Amber",
    light: {
      accent: "#b45309",
      onAccent: "#ffffff",
      background: "#fffaf0",
      foreground: "#451a03",
    },
    dark: {
      accent: "#fbbf24",
      onAccent: "#0b0b0c",
      background: "#271503",
      foreground: "#fef3c7",
    },
  },
  {
    key: "emerald",
    label: "Emerald",
    light: {
      accent: "#047857",
      onAccent: "#ffffff",
      background: "#f2fbf7",
      foreground: "#022c1e",
    },
    dark: {
      accent: "#34d399",
      onAccent: "#0b0b0c",
      background: "#031f15",
      foreground: "#d1fae5",
    },
  },
  {
    key: "sky",
    label: "Sky",
    light: {
      accent: "#0369a1",
      onAccent: "#ffffff",
      background: "#f2f9ff",
      foreground: "#0c2a40",
    },
    dark: {
      accent: "#38bdf8",
      onAccent: "#0b0b0c",
      background: "#061a26",
      foreground: "#e0f2fe",
    },
  },
  {
    key: "slate",
    label: "Slate",
    light: {
      accent: "#334155",
      onAccent: "#ffffff",
      background: "#f6f7f8",
      foreground: "#0f172a",
    },
    dark: {
      accent: "#94a3b8",
      onAccent: "#0b0b0c",
      background: "#0b1120",
      foreground: "#e2e8f0",
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

export const WCAG_AA_CONTRAST = 4.5;
