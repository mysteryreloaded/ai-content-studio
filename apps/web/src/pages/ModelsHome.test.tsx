import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

await GlobalRegistrator.register();

const { cleanup } = await import("@testing-library/react");
const { ModelsHome } = await import("./ModelsHome.js");
const { drainMacrotasks, renderWithProviders } = await import(
  "../test/render.js"
);

afterEach(() => {
  cleanup();
});

afterAll(async () => {
  await drainMacrotasks();
  await GlobalRegistrator.unregister();
});

const SIGNED_IN_USER = {
  id: "u1",
  email: "user@example.com",
  name: "A User",
  picture: null,
  role: "user" as const,
  status: "active" as const,
  termsAcceptedVersion: null,
};

function mockFetch(models: unknown[], status = 200) {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.endsWith("/api/auth/me")) return Response.json(SIGNED_IN_USER);
    if (url.endsWith("/api/models"))
      return Response.json({ models }, { status });
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch;
}

function renderPage() {
  return renderWithProviders(<ModelsHome />);
}

describe("ModelsHome", () => {
  test("lists each enabled Model as one card that links to the Workbench", async () => {
    mockFetch([
      {
        id: "m1",
        slug: "ltx",
        name: "LTX 2.5",
        description: "Fast video generation.",
        modeCount: 2,
        attribution: "Powered by LTX",
      },
    ]);

    const view = renderPage();

    // The whole card is the link: its accessible name is every card field.
    const card = await view.findByRole("link", {
      name: /LTX 2\.5 Fast video generation\. 2 Modes · Powered by LTX/,
    });
    expect(card.getAttribute("href")).toBe("/models/ltx");
  });

  test("the card shows the four spec fields, with a plural Mode count", async () => {
    mockFetch([
      {
        id: "m1",
        slug: "ltx",
        name: "LTX 2.5",
        description: "Fast video generation.",
        modeCount: 2,
        attribution: "",
      },
    ]);

    const view = renderPage();

    await view.findByRole("heading", { name: "Models" });
    expect(await view.findByText("LTX 2.5")).toBeTruthy();
    expect(view.getByText("Fast video generation.")).toBeTruthy();
    expect(view.getByText("2 Modes")).toBeTruthy();
  });

  test('says "1 Mode" for a single-Mode Model and omits the Attribution when unset', async () => {
    mockFetch([
      {
        id: "m1",
        slug: "wan",
        name: "Wan 2.2",
        description: "Video",
        modeCount: 1,
        attribution: "",
      },
    ]);

    const view = renderPage();

    expect(await view.findByText("1 Mode")).toBeTruthy();
    expect(view.queryByText(/·/)).toBeNull();
  });

  test("shows a muted message when there are no enabled Models", async () => {
    mockFetch([]);

    const view = renderPage();

    expect(await view.findByText("No Models yet.")).toBeTruthy();
  });

  test("shows a muted message when the Models request fails", async () => {
    mockFetch([], 500);

    const view = renderPage();

    expect(await view.findByText("could not load Models")).toBeTruthy();
  });
});
