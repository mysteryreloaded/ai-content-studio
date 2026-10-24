/** Issue #65/#31: the System / Light / Dark switch, kept in this browser's local storage. */
export const THEME_STORAGE_KEY = "ai-content-studio:theme";

export const THEME_MODES = ["system", "light", "dark"] as const;
export type ThemeMode = (typeof THEME_MODES)[number];

export const THEME_MODE_LABELS: Record<ThemeMode, string> = {
  system: "System",
  light: "Light",
  dark: "Dark",
};
