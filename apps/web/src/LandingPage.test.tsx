import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { PublicSiteSettings } from "./useSiteSettings.js";

// A real origin (issue #223's auth_error test sets `window.location.search`
// via `pushState`, which happy-dom refuses from the default `about:blank`).
await GlobalRegistrator.register({ url: "http://localhost/" });

const { cleanup, within } = await import("@testing-library/react");
const { LandingPage } = await import("./LandingPage.js");
const { Footer } = await import("./Footer.js");
const { drainMacrotasks, renderWithProviders } = await import(
  "./test/render.js"
);

afterEach(() => {
  cleanup();
  window.history.pushState({}, "", "/");
});

afterAll(async () => {
  await drainMacrotasks();
  await GlobalRegistrator.unregister();
});

const DEFAULT_SITE_SETTINGS = {
  title: "AI Content Studio",
  landingText: "",
  accent: "teal",
  signUpMode: "approval" as const,
  contact: "",
  hasLogo: false,
  hasBackground: false,
  hasTerms: false,
  footerLinks: [],
  hasNonVideoEnabledModel: false,
};

function mockFetch(options: {
  siteSettings?: Partial<PublicSiteSettings>;
  models?: unknown[];
  modelsStatus?: number;
  signedIn?: boolean;
}) {
  const siteSettings = { ...DEFAULT_SITE_SETTINGS, ...options.siteSettings };
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.endsWith("/api/auth/me")) {
      return options.signedIn
        ? Response.json({
            id: "u1",
            email: "user@example.com",
            name: "A User",
            picture: null,
            role: "user",
            status: "active",
            termsAcceptedVersion: null,
          })
        : new Response(null, { status: 401 });
    }
    if (url.endsWith("/api/site-settings")) {
      return Response.json(siteSettings);
    }
    if (url.endsWith("/api/models")) {
      return Response.json(
        { models: options.models ?? [] },
        { status: options.modelsStatus ?? 200 },
      );
    }
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch;
}

function renderPage(route?: string) {
  // The Footer now lives in the app's RootLayout (issue #173), so the test
  // renders it after the page to keep its footer-content coverage. A
  // custom route lets a test exercise `/?auth_error=...` or the
  // signed-in redirect to `/models`.
  return renderWithProviders(
    <>
      <LandingPage />
      <Footer />
    </>,
    route
      ? {
          route,
          routes: [
            { path: "/", element: <LandingPage /> },
            { path: "/models", element: <p>Models home</p> },
          ],
        }
      : undefined,
  );
}

/** Both sign-in links (hero and closing band) point at the Google OAuth route. */
function expectBothSignInLinks(view: ReturnType<typeof renderPage>): void {
  const links = view.getAllByRole("link", { name: /Sign in with Google/ });
  expect(links.length).toBe(2);
  for (const link of links) {
    expect(link.getAttribute("href")).toBe("/api/auth/google");
  }
}

describe("LandingPage", () => {
  test("shows the default landing text for approval sign-up with only video Models", async () => {
    mockFetch({});
    const view = renderPage();

    expect(
      await view.findByText(
        "AI Content Studio runs AI video models on its own GPUs. Sign in with Google to request access.",
      ),
    ).toBeTruthy();
    expectBothSignInLinks(view);
    // Approval mode's quiet line under the hero's button.
    expect(view.getByText("An Admin approves new accounts")).toBeTruthy();
    await view.findByText("Powered by AI Content Studio");
  });

  test('switches to open sign-up wording and "AI models" once a non-video Model is enabled', async () => {
    mockFetch({
      siteSettings: { signUpMode: "open", hasNonVideoEnabledModel: true },
    });
    const view = renderPage();

    expect(
      await view.findByText(
        "AI Content Studio runs AI models on its own GPUs. Sign in with Google to get started.",
      ),
    ).toBeTruthy();
    // Open mode's quiet line under the hero's button.
    expect(view.getByText("Sign in with Google to start")).toBeTruthy();
    await view.findByText("Powered by AI Content Studio");
  });

  test("prefers an Operator-written landing text over the default", async () => {
    mockFetch({ siteSettings: { landingText: "Welcome to our studio!" } });
    const view = renderPage();

    expect(await view.findByText("Welcome to our studio!")).toBeTruthy();
    await view.findByText("Powered by AI Content Studio");
  });

  test("lists enabled Models, each card a sign-in link that returns to it", async () => {
    mockFetch({
      models: [
        {
          id: "m1",
          slug: "ltx",
          name: "LTX 2.5",
          description: "Fast video generation.",
          modeCount: 2,
          attribution: "Powered by LTX 2.5",
        },
      ],
    });
    const view = renderPage();

    // The whole card is the link, so its accessible name is every card field.
    const link = await view.findByRole("link", {
      name: /LTX 2\.5 Fast video generation\. 2 Modes · Powered by LTX 2\.5/,
    });
    expect(link.getAttribute("href")).toBe(
      "/api/auth/google?return_to=%2Fmodels%2Fltx",
    );
    expect(view.getByText("Fast video generation.")).toBeTruthy();
    // The Mode count and Attribution share one small line.
    expect(view.getByText(/2 Modes · Powered by LTX 2\.5/)).toBeTruthy();
    await view.findByText("What you can make");
    await view.findByText("Powered by AI Content Studio");
  });

  test('a single-Mode Model reads "1 Mode" and the Attribution is left out when unset', async () => {
    mockFetch({
      models: [
        {
          id: "m1",
          slug: "wan",
          name: "Wan 2.2",
          description: "Video",
          modeCount: 1,
          attribution: "",
        },
      ],
    });
    const view = renderPage();

    await view.findByText("1 Mode");
    // The card's small line is exactly "1 Mode": no Mode count plural, no
    // "· Attribution" (the footer also has one, so check inside the region).
    const card = view.getByRole("region", { name: "Models" });
    expect(within(card).getByText("1 Mode")).toBeTruthy();
    expect(within(card).queryByText("2 Modes")).toBeNull();
    expect(within(card).queryByText(/·/)).toBeNull();
  });

  test("shows an error when the Models request fails", async () => {
    mockFetch({ models: [], modelsStatus: 500 });
    const view = renderPage();

    expect(await view.findByText("could not load Models")).toBeTruthy();
    expect(view.queryByRole("region", { name: "Models" })).toBeNull();
  });

  test("leaves out the Models section entirely when none are enabled", async () => {
    mockFetch({ models: [] });
    const view = renderPage();

    await view.findByText("An Admin approves new accounts");
    expect(view.queryByRole("region", { name: "Models" })).toBeNull();
    expect(view.queryByText("What you can make")).toBeNull();
    await view.findByText("Powered by AI Content Studio");
  });

  test("shows the auth_error banner and the Operator's contact link for a disabled account", async () => {
    mockFetch({ siteSettings: { contact: "ops@example.com" } });
    // LandingPage reads `window.location.search` directly (issue #65), not
    // the router's own location, so the query string is set here.
    window.history.pushState({}, "", "/?auth_error=disabled");
    const view = renderPage();

    expect(
      await view.findByText("This account has been disabled."),
    ).toBeTruthy();
    const contactLink = view.getByRole("link", { name: "ops@example.com" });
    expect(contactLink.getAttribute("href")).toBe("mailto:ops@example.com");
  });

  test("redirects a signed-in visitor to /models", async () => {
    mockFetch({ signedIn: true });
    const view = renderPage("/");

    expect(await view.findByText("Models home")).toBeTruthy();
  });
});
