// See ../test/happy-dom-setup.ts for why this is registered once, here,
// before @testing-library/react is imported, and never unregistered.
import { afterEach, describe, expect, test } from "bun:test";
import { BUN_FETCH } from "../test/happy-dom-setup.js";

const { cleanup, screen, waitFor } = await import("@testing-library/react");
const { renderWithProviders } = await import("../test/render.js");
const { AdminGenerationsPage } = await import("./AdminGenerationsPage.js");

afterEach(() => {
  cleanup();
  globalThis.fetch = BUN_FETCH;
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

function renderPage(route = "/admin/generations") {
  return renderWithProviders(<AdminGenerationsPage />, {
    route,
    routes: [
      { path: "/admin/generations", element: <AdminGenerationsPage /> },
      { path: "/admin/generations/:id", element: <p>Detail page</p> },
    ],
  });
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

const ROW_TEST = {
  ...ROW_SUCCEEDED,
  id: "g3",
  userId: "u3",
  userName: "Test Runner",
  isTest: true,
  submittedAt: new Date("2026-01-04T00:00:00Z").toISOString(),
};

/** The list endpoint, never the `/resolve/:id` jump-to one (hc drops the "?" when the query is empty). */
function isGenerationsList(url: string): boolean {
  return (
    url === "/api/admin/generations" ||
    url.startsWith("/api/admin/generations?")
  );
}

function defaultHandler(generations: unknown[]) {
  return (call: FetchCall): Response => {
    if (call.url.endsWith("/api/admin/models")) {
      return Response.json({ models: [{ id: "m1", name: "LTX 2.5" }] });
    }
    if (isGenerationsList(call.url)) {
      return Response.json({ generations, hasMore: false });
    }
    throw new Error(`unexpected fetch ${call.method} ${call.url}`);
  };
}

describe("AdminGenerationsPage (issue #68, #209)", () => {
  test("lists Generations across users, labelling a Removal distinctly from its own state", async () => {
    mockFetch(defaultHandler([ROW_SUCCEEDED, ROW_REMOVED]));

    renderPage();
    await screen.findByText("A User");
    await screen.findByText("Another User");

    const rows = screen.getAllByRole("row");
    // header row + 2 data rows
    expect(rows).toHaveLength(3);
    expect(rows[1]?.textContent).toContain("Succeeded");
    expect(rows[2]?.textContent).toContain("Removed");
    const links = screen
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
      if (isGenerationsList(call.url)) {
        const status = new URL(call.url, "http://x").searchParams.get("status");
        statuses.push(status ?? "");
        return Response.json({ generations: [], hasMore: false });
      }
      throw new Error(`unexpected fetch ${call.method} ${call.url}`);
    });

    renderPage();
    await screen.findByText("No Generations match these filters.");

    const { default: userEvent } = await import("@testing-library/user-event");
    await userEvent.click(screen.getByLabelText("State"));
    await userEvent.click(
      await screen.findByRole("option", { name: "Removed" }),
    );

    await waitFor(() => expect(statuses).toContain("removed"));
  });

  test("Jump to resolves an Asset id to its own Generation's detail page", async () => {
    mockFetch((call) => {
      if (call.url.endsWith("/api/admin/models")) {
        return Response.json({ models: [] });
      }
      if (isGenerationsList(call.url)) {
        return Response.json({ generations: [], hasMore: false });
      }
      if (call.url === "/api/admin/generations/resolve/asset-1") {
        return Response.json({ generationId: "g1" });
      }
      throw new Error(`unexpected fetch ${call.method} ${call.url}`);
    });

    renderPage();
    await screen.findByText("No Generations match these filters.");

    const { default: userEvent } = await import("@testing-library/user-event");
    await userEvent.type(
      screen.getByLabelText("Jump to a Generation or Asset id"),
      "asset-1",
    );
    await userEvent.click(screen.getByRole("button", { name: "Go" }));

    expect(await screen.findByText("Detail page")).toBeTruthy();
  });

  test("marks Test Generations", async () => {
    mockFetch(defaultHandler([ROW_TEST]));

    renderPage();
    await screen.findByText("Test Runner");

    expect(screen.getByText("Test")).toBeTruthy();
  });

  test("shows the filtered user's name", async () => {
    mockFetch((call) => {
      if (call.url.endsWith("/api/admin/models")) {
        return Response.json({ models: [] });
      }
      if (call.url.includes("/api/admin/users/u1")) {
        return Response.json({ id: "u1", name: "Alice", email: "a@x.com" });
      }
      if (isGenerationsList(call.url)) {
        return Response.json({ generations: [], hasMore: false });
      }
      throw new Error(`unexpected fetch ${call.method} ${call.url}`);
    });

    renderPage("/admin/generations?user=u1");

    expect(await screen.findByText("Filtered to Alice ×")).toBeTruthy();
  });
});
