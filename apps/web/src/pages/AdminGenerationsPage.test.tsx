// See ModelEditorPage.test.tsx's header comment: this file registers its
// own happy-dom instance (bun test --isolate gives it a clean process).
import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

await GlobalRegistrator.register();

const { cleanup, render, waitFor } = await import("@testing-library/react");
const { createMemoryRouter, RouterProvider } = await import("react-router-dom");
const { AdminGenerationsPage } = await import("./AdminGenerationsPage.js");

afterEach(() => {
  cleanup();
});

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

interface FetchCall {
  method: string;
  url: string;
}

function mockFetch(handler: (call: FetchCall) => Response | Promise<Response>) {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    return handler({
      method: (init?.method ?? "GET").toUpperCase(),
      url,
    });
  }) as typeof fetch;
}

function renderPage(initialEntry = "/admin/generations") {
  const router = createMemoryRouter(
    [
      { path: "/admin/generations", element: <AdminGenerationsPage /> },
      { path: "/admin/generations/:id", element: <p>Detail page</p> },
    ],
    { initialEntries: [initialEntry] },
  );
  return render(<RouterProvider router={router} />);
}

const ROW_SUCCEEDED = {
  id: "g1",
  modelId: "m1",
  modelName: "LTX 2.5",
  modelSlug: "ltx",
  modeId: "mode1",
  modeName: "Default",
  userId: "u1",
  userEmail: "user@example.com",
  userName: "A User",
  state: "succeeded",
  isTest: false,
  deletedAt: null,
  removedAt: null,
  submittedAt: new Date("2026-01-01T00:00:00Z").toISOString(),
  endedAt: new Date("2026-01-01T00:01:00Z").toISOString(),
};

const ROW_REMOVED = {
  ...ROW_SUCCEEDED,
  id: "g2",
  userId: "u2",
  userName: "Another User",
  state: "succeeded",
  submittedAt: new Date("2026-01-03T00:00:00Z").toISOString(),
  removedAt: new Date("2026-01-02T00:00:00Z").toISOString(),
};

describe("AdminGenerationsPage (issue #68)", () => {
  test("lists Generations across users, labelling a Removal distinctly from its own state", async () => {
    mockFetch((call) => {
      if (call.url.endsWith("/api/admin/models")) {
        return Response.json({
          models: [{ id: "m1", name: "LTX 2.5" }],
        });
      }
      if (call.url.startsWith("/api/admin/generations?")) {
        return Response.json({
          generations: [ROW_SUCCEEDED, ROW_REMOVED],
          hasMore: false,
        });
      }
      throw new Error(`unexpected fetch ${call.method} ${call.url}`);
    });

    const view = renderPage();
    await view.findByText("A User");
    await view.findByText("Another User");

    const rows = view.getAllByRole("row");
    // header row + 2 data rows
    expect(rows).toHaveLength(3);
    expect(rows[1]?.textContent).toContain("succeeded");
    expect(rows[2]?.textContent).toContain("removed");
    const links = view
      .getAllByRole("link")
      .filter((link) =>
        link.getAttribute("href")?.startsWith("/admin/generations/"),
      );
    expect(links.map((link) => link.getAttribute("href"))).toContain(
      "/admin/generations/g1",
    );
  });

  test("filtering by status re-requests the list with that status in the query", async () => {
    const statuses: string[] = [];
    mockFetch((call) => {
      if (call.url.endsWith("/api/admin/models")) {
        return Response.json({ models: [] });
      }
      if (call.url.startsWith("/api/admin/generations?")) {
        const status = new URL(call.url, "http://x").searchParams.get("status");
        statuses.push(status ?? "");
        return Response.json({ generations: [], hasMore: false });
      }
      throw new Error(`unexpected fetch ${call.method} ${call.url}`);
    });

    const view = renderPage();
    await view.findByText("No Generations match these filters.");

    const { default: userEvent } = await import("@testing-library/user-event");
    await userEvent.selectOptions(view.getByLabelText("State"), "removed");

    await waitFor(() => expect(statuses).toContain("removed"));
  });

  test("Jump to resolves an Asset id to its own Generation's detail page", async () => {
    mockFetch((call) => {
      if (call.url.endsWith("/api/admin/models")) {
        return Response.json({ models: [] });
      }
      if (call.url.startsWith("/api/admin/generations?")) {
        return Response.json({ generations: [], hasMore: false });
      }
      if (call.url === "/api/admin/generations/resolve/asset-1") {
        return Response.json({ generationId: "g1" });
      }
      throw new Error(`unexpected fetch ${call.method} ${call.url}`);
    });

    const view = renderPage();
    await view.findByText("No Generations match these filters.");

    const { default: userEvent } = await import("@testing-library/user-event");
    await userEvent.type(
      view.getByLabelText("Jump to a Generation or Asset id"),
      "asset-1",
    );
    await userEvent.click(view.getByRole("button", { name: "Go" }));

    expect(await view.findByText("Detail page")).toBeTruthy();
  });
});
