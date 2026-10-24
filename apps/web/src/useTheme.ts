import { useCallback, useEffect, useState } from "react";
import { THEME_MODES, THEME_STORAGE_KEY, type ThemeMode } from "./theme.js";

function readStoredTheme(): ThemeMode {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return (THEME_MODES as readonly string[]).includes(stored ?? "")
      ? (stored as ThemeMode)
      : "system";
  } catch {
    return "system";
  }
}

/** Mirrors the inline script in `index.html`, which already applies this before first paint. */
function applyTheme(theme: ThemeMode): void {
  if (theme === "system") {
    document.documentElement.removeAttribute("data-theme");
  } else {
    document.documentElement.setAttribute("data-theme", theme);
  }
}

function systemPrefersDark(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
}

// `localStorage`'s own `storage` event never fires in the tab that made
// the change, so a second component on the same page (the footer's
// ThemeSwitch and the landing page's GoogleSignInButton, say) would
// otherwise only pick up a change on the next full page load. This
// tiny same-tab pub/sub keeps every `useTheme()` call in sync the
// moment any one of them calls `setTheme`.
const listeners = new Set<(theme: ThemeMode) => void>();

export interface ThemeState {
  theme: ThemeMode;
  /** What's actually showing right now, for the Google button to match (issue #65). */
  resolvedTheme: "light" | "dark";
  setTheme: (theme: ThemeMode) => void;
}

/** The System / Light / Dark switch (issue #65/#31), shared by every `ThemeSwitch`. */
export function useTheme(): ThemeState {
  const [theme, setThemeState] = useState<ThemeMode>(readStoredTheme);
  const [prefersDark, setPrefersDark] = useState<boolean>(systemPrefersDark);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const listener = (event: MediaQueryListEvent) =>
      setPrefersDark(event.matches);
    media.addEventListener("change", listener);
    return () => media.removeEventListener("change", listener);
  }, []);

  useEffect(() => {
    listeners.add(setThemeState);
    return () => {
      listeners.delete(setThemeState);
    };
  }, []);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const setTheme = useCallback((next: ThemeMode) => {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Private browsing or a blocked storage still lets the choice
      // apply for this page view; it just won't be remembered.
    }
    for (const listener of listeners) listener(next);
  }, []);

  const resolvedTheme =
    theme === "system" ? (prefersDark ? "dark" : "light") : theme;

  return { theme, resolvedTheme, setTheme };
}
