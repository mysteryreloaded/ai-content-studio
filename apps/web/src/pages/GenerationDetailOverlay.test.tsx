// See ModelEditorPage.test.tsx's header comment: this file registers its
// own happy-dom instance (bun test --isolate gives it a clean process).
import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

await GlobalRegistrator.register();

const { cleanup, render, waitFor } = await import("@testing-library/react");
const { createMemoryRouter, RouterProvider } = await import("react-router-dom");
const { GalleryPage } = await import("./GalleryPage.js");

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

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  listeners: Record<string, Array<(event: { data: string }) => void>> = {};
  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }
  addEventListener() {}
  close() {}
}

interface FetchCall {
  method: string;
  url: string;
}

function mockFetch(handler: (call: FetchCall) => Response | Promise<Response>) {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.endsWith("/api/auth/me")) return Response.json(SIGNED_IN_USER);
    return handler({
      method: (init?.method ?? "GET").toUpperCase(),
      url,
    });
  }) as typeof fetch;
}

function renderAt(initialEntry: string) {
  (globalThis as unknown as { EventSource: unknown }).EventSource =
    FakeEventSource;
  FakeEventSource.instances = [];

  const router = createMemoryRouter(
    [
      { path: "/gallery", element: <GalleryPage /> },
      { path: "/generations/:id", element: <GalleryPage /> },
    ],
    { initialEntries: [initialEntry] },
  );
  return render(<RouterProvider router={router} />);
}

const GENERATION_1 = {
  id: "g1",
  state: "succeeded",
  error: null,
  tries: 1,
  submittedAt: new Date().toISOString(),
  startedAt: new Date().toISOString(),
  endedAt: new Date().toISOString(),
  deletedAt: null,
  modelId: "m1",
  modelSlug: "ltx",
  modelName: "LTX 2.5",
  modelAttribution: "",
  modelDeleted: false,
  modeId: "mode1",
  modeName: "Default",
  assets: [
    {
      id: "a1",
      nodeId: "3",
      sortOrder: 0,
      kind: "image",
      contentType: "image/png",
      size: 100,
      width: 10,
      height: 10,
      durationMs: null,
      fps: null,
    },
  ],
  settings: [],
};

const SUBMISSION_1 = {
  submissionId: "sub1",
  modelId: "m1",
  modelSlug: "ltx",
  modelName: "LTX 2.5",
  modeId: "mode1",
  modeName: "Default",
  submittedAt: GENERATION_1.submittedAt,
  generations: [
    {
      id: "g1",
      modelId: "m1",
      modeId: "mode1",
      modeName: "Default",
      submissionId: "sub1",
      state: "succeeded",
      error: null,
      submittedAt: GENERATION_1.submittedAt,
      assets: GENERATION_1.assets,
    },
    {
      id: "g2",
      modelId: "m1",
      modeId: "mode1",
      modeName: "Default",
      submissionId: "sub1",
      state: "succeeded",
      error: null,
      submittedAt: GENERATION_1.submittedAt,
      assets: GENERATION_1.assets,
    },
  ],
};

const GENERATION_2 = { ...GENERATION_1, id: "g2" };

describe("GenerationDetailOverlay (issue #57)", () => {
  test("404s when the Generation is missing or not this user's own", async () => {
    mockFetch((call) => {
      if (call.url.endsWith("/api/gallery/models")) {
        return Response.json({ models: [] });
      }
      if (call.url.includes("/api/gallery?")) {
        return Response.json({ submissions: [], hasMore: false });
      }
      if (call.url === "/api/generations/missing") {
        return Response.json({ error: "not found" }, { status: 404 });
      }
      throw new Error(`unexpected fetch ${call.url}`);
    });

    const view = renderAt("/generations/missing");
    expect(await view.findByText("Not found.")).toBeTruthy();
  });

  test("←/→ navigates between the Gallery's loaded Generations", async () => {
    mockFetch((call) => {
      if (call.url.endsWith("/api/gallery/models")) {
        return Response.json({ models: [] });
      }
      if (call.url.includes("/api/gallery?")) {
        return Response.json({ submissions: [SUBMISSION_1], hasMore: false });
      }
      if (call.url === "/api/generations/g1") {
        return Response.json(GENERATION_1);
      }
      if (call.url === "/api/generations/g2") {
        return Response.json(GENERATION_2);
      }
      throw new Error(`unexpected fetch ${call.url}`);
    });

    const view = renderAt("/generations/g1");
    await waitFor(() => expect(view.getByText("Id")).toBeTruthy());

    expect(
      view.getByRole("button", { name: "Previous Generation" }),
    ).toHaveProperty("disabled", true);
    const next = view.getByRole("button", { name: "Next Generation" });
    expect(next).toHaveProperty("disabled", false);

    const { default: userEvent } = await import("@testing-library/user-event");
    await userEvent.click(next);

    await waitFor(() =>
      expect(
        view.getByRole("button", { name: "Next Generation" }),
      ).toHaveProperty("disabled", true),
    );
  });

  test("Delete tombstones the Generation and closes the dialog", async () => {
    let deleted = false;
    mockFetch((call) => {
      if (call.url.endsWith("/api/gallery/models")) {
        return Response.json({ models: [] });
      }
      if (call.url.includes("/api/gallery?")) {
        return Response.json({
          submissions: deleted ? [] : [SUBMISSION_1],
          hasMore: false,
        });
      }
      if (call.url === "/api/generations/g1" && call.method === "DELETE") {
        deleted = true;
        return Response.json({ ok: true });
      }
      if (call.url === "/api/generations/g1") {
        return Response.json(GENERATION_1);
      }
      throw new Error(`unexpected fetch ${call.method} ${call.url}`);
    });

    const originalConfirm = window.confirm;
    window.confirm = () => true;
    try {
      const view = renderAt("/generations/g1");
      await waitFor(() => expect(view.getByText("Id")).toBeTruthy());

      const { default: userEvent } = await import(
        "@testing-library/user-event"
      );
      await userEvent.click(view.getByRole("button", { name: "Delete" }));

      await waitFor(() => expect(deleted).toBe(true));
      await waitFor(() => expect(view.queryByText("Id")).toBeNull());
    } finally {
      window.confirm = originalConfirm;
    }
  });
});
