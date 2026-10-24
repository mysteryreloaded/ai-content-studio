import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { PublicSiteSettings } from "./useSiteSettings.js";

await GlobalRegistrator.register();

const { cleanup, render } = await import("@testing-library/react");
const { MemoryRouter } = await import("react-router-dom");
const { LandingPage } = await import("./LandingPage.js");

afterEach(() => {
  cleanup();
});

afterAll(async () => {
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
      return Response.json({ models: options.models ?? [] });
    }
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch;
}

function renderPage() {
  return render(
    <MemoryRouter>
      <LandingPage />
    </MemoryRouter>,
  );
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
    expect(view.getByText("Sign in with Google")).toBeTruthy();
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
    await view.findByText("Powered by AI Content Studio");
  });

  test("prefers an Operator-written landing text over the default", async () => {
    mockFetch({ siteSettings: { landingText: "Welcome to our studio!" } });
    const view = renderPage();

    expect(await view.findByText("Welcome to our studio!")).toBeTruthy();
    await view.findByText("Powered by AI Content Studio");
  });

  test("lists enabled Models, each a sign-in link that returns to it", async () => {
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

    const link = await view.findByRole("link", { name: "LTX 2.5" });
    expect(link.getAttribute("href")).toBe(
      "/api/auth/google?return_to=%2Fmodels%2Fltx",
    );
    expect(view.getByText("Fast video generation.")).toBeTruthy();
    expect(view.getByText("Powered by LTX 2.5")).toBeTruthy();
    await view.findByText("Powered by AI Content Studio");
  });

  test("leaves out the Models section entirely when none are enabled", async () => {
    mockFetch({ models: [] });
    const view = renderPage();

    await view.findByText("Sign in with Google");
    expect(view.queryByRole("region", { name: "Models" })).toBeNull();
    await view.findByText("Powered by AI Content Studio");
  });
});
