import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

await GlobalRegistrator.register();

const { cleanup, render } = await import("@testing-library/react");
const { PrivacyPage } = await import("./PrivacyPage.js");

afterEach(() => {
  cleanup();
});

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

function mockFetch(response: Response | (() => Response)) {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.endsWith("/api/site-settings")) {
      return Response.json({
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
      });
    }
    if (url.endsWith("/api/privacy")) {
      return typeof response === "function" ? response() : response;
    }
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch;
}

describe("PrivacyPage", () => {
  test("shows the Operator's part and the generated section once loaded", async () => {
    mockFetch(
      Response.json({
        operatorBody: "We keep it simple.",
        operatorUpdatedAt: "2026-01-01T00:00:00.000Z",
        generatedBody: "## What this studio stores",
      }),
    );
    const view = render(<PrivacyPage />);

    expect(await view.findByText("We keep it simple.")).toBeTruthy();
    expect(
      await view.findByRole("heading", { name: "What this studio stores" }),
    ).toBeTruthy();
  });

  test("shows an error instead of crashing on a non-OK response", async () => {
    mockFetch(new Response("oops", { status: 500 }));
    const view = render(<PrivacyPage />);

    expect(
      await view.findByText(
        "Could not load the Privacy policy. Please try again.",
      ),
    ).toBeTruthy();
  });

  test("shows an error when the response body isn't valid JSON", async () => {
    mockFetch(new Response("not json", { status: 200 }));
    const view = render(<PrivacyPage />);

    expect(
      await view.findByText(
        "Could not load the Privacy policy. Please try again.",
      ),
    ).toBeTruthy();
  });
});
