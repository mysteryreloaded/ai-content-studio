import { findAccentPalette } from "@ai-content-studio/shared";

/**
 * A `<style>`/`<meta>` snippet coloring interactive elements, `theme-color`
 * and the default landing background from the accent's light/dark pair.
 * Injected into every served `index.html` (see `app.ts`).
 */
export function accentHeadSnippet(accentKey: string): string {
  const palette = findAccentPalette(accentKey) ?? findAccentPalette("teal");
  if (!palette) return "";

  const { light, dark } = palette;

  return `<meta name="theme-color" content="${light.accent}" media="(prefers-color-scheme: light)">
    <meta name="theme-color" content="${dark.accent}" media="(prefers-color-scheme: dark)">
    <style>
      /*
       * Issue #65/#31: the app has no page-wide stylesheet, so
       * color-scheme is what actually makes Light/Dark do anything
       * outside the landing page's own styled main element — it tells
       * the browser's own UA stylesheet which palette to paint the
       * page background, text, form controls and scrollbars with.
       * "light dark" (the default) follows the OS; an explicit
       * data-theme below pins it to the chosen scheme regardless of
       * the OS.
       */
      :root {
        color-scheme: light dark;
        --accent: ${light.accent};
        --on-accent: ${light.onAccent};
        --landing-background: ${light.background};
        --landing-foreground: ${light.foreground};
      }
      /*
       * "system" (the default) follows the OS unless the visitor's own
       * System/Light/Dark switch (useTheme.ts) has set
       * data-theme="light" on <html>, which this media query must then
       * leave alone; data-theme="dark" below always wins regardless of
       * the OS.
       */
      @media (prefers-color-scheme: dark) {
        :root:not([data-theme="light"]) {
          --accent: ${dark.accent};
          --on-accent: ${dark.onAccent};
          --landing-background: ${dark.background};
          --landing-foreground: ${dark.foreground};
        }
      }
      :root[data-theme="light"] {
        color-scheme: light;
      }
      :root[data-theme="dark"] {
        color-scheme: dark;
        --accent: ${dark.accent};
        --on-accent: ${dark.onAccent};
        --landing-background: ${dark.background};
        --landing-foreground: ${dark.foreground};
      }
    </style>`;
}

/** Inserts `snippet` just before `</head>`, and a favicon `<link>` when `logoHref` is set. */
export function injectBrandingIntoHtml(
  html: string,
  accentKey: string,
  logoHref: string | null,
): string {
  const favicon = logoHref ? `<link rel="icon" href="${logoHref}">` : "";
  return html.replace(
    "</head>",
    `${accentHeadSnippet(accentKey)}\n    ${favicon}\n  </head>`,
  );
}
