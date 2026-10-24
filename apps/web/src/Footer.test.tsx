import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { PublicSiteSettings } from "./useSiteSettings.js";

await GlobalRegistrator.register();

const { cleanup, render } = await import("@testing-library/react");
const { Footer } = await import("./Footer.js");

afterEach(() => {
  cleanup();
});

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

const DEFAULT_SITE_SETTINGS: PublicSiteSettings = {
  title: "AI Content Studio",
  landingText: "",
  accent: "teal",
  signUpMode: "approval",
  contact: "",
  hasLogo: false,
  hasBackground: false,
  hasTerms: false,
  footerLinks: [],
  hasNonVideoEnabledModel: false,
};

function mockFetch(overrides: Partial<PublicSiteSettings>) {
  const settings = { ...DEFAULT_SITE_SETTINGS, ...overrides };
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.endsWith("/api/site-settings")) return Response.json(settings);
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch;
}

function renderFooter() {
  return render(<Footer />);
}

describe("Footer", () => {
  test("always shows Privacy, the theme switch and the repo credit", async () => {
    mockFetch({});
    const view = renderFooter();

    const privacy = await view.findByRole("link", { name: "Privacy" });
    expect(privacy.getAttribute("href")).toBe("/privacy");
    expect(view.getByRole("group", { name: "Theme" })).toBeTruthy();
    const credit = view.getByRole("link", {
      name: "Powered by AI Content Studio",
    });
    expect(credit.getAttribute("href")).toBe(
      "https://github.com/mysteryreloaded/ai-content-studio",
    );
  });

  test("leaves out Terms when hasTerms is false", async () => {
    mockFetch({ hasTerms: false });
    const view = renderFooter();

    await view.findByRole("link", { name: "Privacy" });
    expect(view.queryByRole("link", { name: "Terms" })).toBeNull();
  });

  test("shows Terms when hasTerms is true", async () => {
    mockFetch({ hasTerms: true });
    const view = renderFooter();

    const terms = await view.findByRole("link", { name: "Terms" });
    expect(terms.getAttribute("href")).toBe("/terms");
  });

  test("leaves out Contact when it's blank", async () => {
    mockFetch({ contact: "" });
    const view = renderFooter();

    await view.findByRole("link", { name: "Privacy" });
    expect(
      view.queryByRole("link", { name: "Contact · Report abuse" }),
    ).toBeNull();
  });

  test("shows Contact · Report abuse as a mailto: link for an email contact", async () => {
    mockFetch({ contact: "abuse@example.com" });
    const view = renderFooter();

    const contact = await view.findByRole("link", {
      name: "Contact · Report abuse",
    });
    expect(contact.getAttribute("href")).toBe("mailto:abuse@example.com");
  });

  test("shows Contact · Report abuse as a plain link for a URL contact", async () => {
    mockFetch({ contact: "https://example.com/contact" });
    const view = renderFooter();

    const contact = await view.findByRole("link", {
      name: "Contact · Report abuse",
    });
    expect(contact.getAttribute("href")).toBe("https://example.com/contact");
  });

  test("shows up to 3 extra footer links, each opening in a new tab", async () => {
    mockFetch({
      footerLinks: [
        { label: "Imprint", url: "https://example.com/imprint" },
        { label: "Status", url: "https://status.example.com" },
      ],
    });
    const view = renderFooter();

    const imprint = await view.findByRole("link", { name: "Imprint" });
    expect(imprint.getAttribute("href")).toBe("https://example.com/imprint");
    expect(imprint.getAttribute("target")).toBe("_blank");
    expect(imprint.getAttribute("rel")).toBe("noopener noreferrer");
    expect(view.getByRole("link", { name: "Status" })).toBeTruthy();
  });
});
