import { describe, expect, test } from "bun:test";
import { injectBrandingIntoHtml } from "./accent-html.js";

const BASE_HTML = "<html><head><title>t</title></head><body></body></html>";

describe("injectBrandingIntoHtml", () => {
  test("injects theme-color and CSS vars for the accent, before </head>", () => {
    const html = injectBrandingIntoHtml(BASE_HTML, "rose", null);
    expect(html).toContain('name="theme-color"');
    expect(html).toContain("--accent: #be123c");
    expect(html).toContain("--landing-background: #fff5f6");
    expect(html.indexOf("--accent")).toBeLessThan(html.indexOf("</head>"));
  });

  test('the dark palette also applies under an explicit data-theme="dark" (issue #65)', () => {
    const html = injectBrandingIntoHtml(BASE_HTML, "rose", null);
    expect(html).toContain('[data-theme="dark"]');
    expect(html).toContain(':not([data-theme="light"])');
  });

  test("falls back to teal for an unknown accent key", () => {
    const html = injectBrandingIntoHtml(BASE_HTML, "not-a-real-accent", null);
    expect(html).toContain("--accent: #0f766e");
  });

  test("adds a favicon link only when a logo href is given", () => {
    expect(injectBrandingIntoHtml(BASE_HTML, "teal", null)).not.toContain(
      'rel="icon"',
    );
    expect(
      injectBrandingIntoHtml(BASE_HTML, "teal", "/api/site-settings/logo"),
    ).toContain('<link rel="icon" href="/api/site-settings/logo">');
  });
});
