import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

await GlobalRegistrator.register();

const { cleanup, render } = await import("@testing-library/react");
const { MemoryRouter } = await import("react-router-dom");
const { ModelsHome } = await import("./ModelsHome.js");

afterEach(() => {
  cleanup();
});

afterAll(async () => {
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

function mockFetch(models: unknown[]) {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.endsWith("/api/auth/me")) return Response.json(SIGNED_IN_USER);
    if (url.endsWith("/api/models")) return Response.json({ models });
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch;
}

function renderPage() {
  return render(
    <MemoryRouter>
      <ModelsHome />
    </MemoryRouter>,
  );
}

describe("ModelsHome", () => {
  test("lists enabled Models with a nav link each", async () => {
    mockFetch([
      {
        id: "m1",
        slug: "ltx",
        name: "LTX 2.5",
        description: "Video",
        modeCount: 2,
      },
    ]);

    const view = renderPage();

    expect(await view.findByRole("heading", { name: "LTX 2.5" })).toBeTruthy();
    expect(view.getByRole("navigation", { name: "Models" })).toBeTruthy();
    expect(view.getByRole("link", { name: "LTX 2.5" })).toBeTruthy();
    expect(view.getByText("2 Modes")).toBeTruthy();
  });

  test("shows a message when there are no enabled Models", async () => {
    mockFetch([]);

    const view = renderPage();

    expect(await view.findByText("No Models yet.")).toBeTruthy();
    expect(view.queryByRole("navigation", { name: "Models" })).toBeNull();
  });
});
