// See ../test/happy-dom-setup.ts for why this is registered once, here,
// before @testing-library/react is imported, and never unregistered.
import { afterEach, describe, expect, test } from "bun:test";
import { BUN_FETCH } from "../test/happy-dom-setup.js";

const { cleanup, screen, waitFor } = await import("@testing-library/react");
const { renderWithProviders } = await import("../test/render.js");
const { AdminGenerationDetailPage } = await import(
  "./AdminGenerationDetailPage.js"
);

afterEach(() => {
  cleanup();
  globalThis.fetch = BUN_FETCH;
});

interface FetchCall {
  method: string;
  url: string;
}

const DETAIL = {
  id: "0193b2a4-aaaa-bbbb-cccc-000000000001",
  state: "succeeded",
  error: null,
  tries: 1,
  submittedAt: "2026-01-01T00:00:00.000Z",
  startedAt: "2026-01-01T00:00:05.000Z",
  endedAt: "2026-01-01T00:01:00.000Z",
  deletedAt: null,
  removedAt: null,
  removedReason: null,
  isTest: false,
  ownerId: "u1",
  ownerEmail: "alice@example.com",
  ownerName: "Alice",
  modelId: "m1",
  modelSlug: "ltx",
  modelName: "LTX 2.5",
  modelAttribution: "LTX 2.5 by Lightricks",
  modelDeleted: false,
  modeId: "mode1",
  modeName: "Default",
  assets: [],
  settings: [],
};

function mockFetch(handler: (call: FetchCall) => Response | Promise<Response>) {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    return handler({
      method: (init?.method ?? "GET").toUpperCase(),
      url,
    });
  }) as typeof fetch;
}

function renderPage(detail: Record<string, unknown> = DETAIL) {
  mockFetch((call) => {
    if (call.method === "GET" && call.url.includes("/api/admin/generations/")) {
      return Response.json(detail);
    }
    throw new Error(`unexpected fetch ${call.method} ${call.url}`);
  });
  return renderWithProviders(<AdminGenerationDetailPage />, {
    route: `/admin/generations/${detail.id}`,
    routes: [
      {
        path: "/admin/generations/:id",
        element: <AdminGenerationDetailPage />,
      },
    ],
  });
}

describe("AdminGenerationDetailPage (issue #68, #209)", () => {
  test("shows owner, tries and the full id with Copy", async () => {
    renderPage();

    await screen.findByText("Alice");
    expect(screen.getByText("alice@example.com")).toBeTruthy();
    expect(screen.getByText("1")).toBeTruthy();
    expect(screen.getByText(DETAIL.id)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy" })).toBeTruthy();
  });

  test("Remove needs a reason", async () => {
    renderPage();
    await screen.findByText("Alice");

    const { default: userEvent } = await import("@testing-library/user-event");
    await userEvent.click(screen.getByRole("button", { name: "Remove…" }));

    const removeButton = (await screen.findByRole("button", {
      name: "Remove",
    })) as HTMLButtonElement;
    expect(removeButton.disabled).toBe(true);

    await userEvent.type(
      screen.getByLabelText("Reason (required, up to 500 characters)"),
      "breaks the rules",
    );
    await waitFor(() => expect(removeButton.disabled).toBe(false));
  });

  test("links to the Generation's Log entries", async () => {
    renderPage();
    await screen.findByText("Alice");

    const link = screen.getByRole("link", { name: "Log entries" });
    expect(link.getAttribute("href")).toBe(
      `/admin/logs?generationId=${DETAIL.id}`,
    );
  });

  test("shows the removal reason and no Remove button once removed", async () => {
    renderPage({
      ...DETAIL,
      removedAt: "2026-01-02T00:00:00.000Z",
      removedReason: "shared someone else's likeness",
    });

    await screen.findByText(/shared someone else's likeness/);
    expect(screen.queryByRole("button", { name: "Remove…" })).toBeNull();
  });
});
