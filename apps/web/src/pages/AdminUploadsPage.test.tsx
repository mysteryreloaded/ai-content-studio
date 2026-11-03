// See ../test/happy-dom-setup.ts for why this is registered once, here,
// before @testing-library/react is imported, and never unregistered.
import { afterEach, describe, expect, test } from "bun:test";
import { BUN_FETCH } from "../test/happy-dom-setup.js";

const { cleanup, screen, waitFor } = await import("@testing-library/react");
const { renderWithProviders } = await import("../test/render.js");
const { AdminUploadsPage } = await import("./AdminUploadsPage.js");

afterEach(() => {
  cleanup();
  globalThis.fetch = BUN_FETCH;
});

interface FetchCall {
  method: string;
  url: string;
}

const UPLOAD = {
  id: "up1",
  originalName: "clip.mp4",
  size: 2_400_000,
  status: "complete",
  kind: "video",
  thumbnailKey: null,
  width: 1920,
  height: 1080,
  durationMs: 5000,
  trimmedFromId: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  removedAt: null,
  removedReason: null,
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

function renderPage(uploads: unknown[] = [UPLOAD]) {
  mockFetch((call) => {
    if (call.url.includes("/api/admin/users/u1")) {
      return Response.json({ id: "u1", name: "Alice", email: "a@x.com" });
    }
    if (call.method === "POST" && call.url.includes("/remove")) {
      return Response.json({
        upload: {
          ...UPLOAD,
          removedAt: "2026-01-02T00:00:00.000Z",
          removedReason: "broke the rules",
        },
      });
    }
    if (call.url.startsWith("/api/admin/uploads?")) {
      return Response.json({ uploads });
    }
    throw new Error(`unexpected fetch ${call.method} ${call.url}`);
  });
  return renderWithProviders(<AdminUploadsPage />, {
    route: "/admin/users/u1/uploads",
    routes: [
      { path: "/admin/users/:id/uploads", element: <AdminUploadsPage /> },
    ],
  });
}

describe("AdminUploadsPage (issue #68, #209)", () => {
  test("names the user and lists Uploads with status", async () => {
    renderPage();

    await screen.findByText("clip.mp4");
    expect(screen.getByText("Alice", { exact: false })).toBeTruthy();
    expect(screen.getByText("Complete")).toBeTruthy();
    expect(screen.getByText("2.3 MB")).toBeTruthy();
  });

  test("This user has no Uploads.", async () => {
    renderPage([]);
    expect(await screen.findByText("This user has no Uploads.")).toBeTruthy();
  });

  test("removes an Upload through the dialog", async () => {
    renderPage();
    await screen.findByText("clip.mp4");

    const { default: userEvent } = await import("@testing-library/user-event");
    await userEvent.click(screen.getByRole("button", { name: "Remove…" }));
    await userEvent.type(
      screen.getByLabelText("Reason (required, up to 500 characters)"),
      "broke the rules",
    );
    await userEvent.click(screen.getByRole("button", { name: "Remove" }));

    await waitFor(() => expect(screen.getByText("Removed")).toBeTruthy());
    expect(screen.getByText("broke the rules")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Remove…" })).toBeNull();
  });
});
