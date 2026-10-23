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
      :root {
        --accent: ${light.accent};
        --on-accent: ${light.onAccent};
        --landing-background: ${light.background};
        --landing-foreground: ${light.foreground};
      }
      @media (prefers-color-scheme: dark) {
        :root {
          --accent: ${dark.accent};
          --on-accent: ${dark.onAccent};
          --landing-background: ${dark.background};
          --landing-foreground: ${dark.foreground};
        }
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
