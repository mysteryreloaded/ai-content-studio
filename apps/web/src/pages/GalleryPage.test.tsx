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
  addEventListener(type: string, cb: (event: { data: string }) => void) {
    const list = this.listeners[type] ?? [];
    list.push(cb);
    this.listeners[type] = list;
  }
  close() {}
  emit(type: string, data: unknown) {
    for (const cb of this.listeners[type] ?? []) {
      cb({ data: JSON.stringify(data) });
    }
  }
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

function renderGallery(initialEntry = "/gallery") {
  (globalThis as unknown as { EventSource: unknown }).EventSource =
    FakeEventSource;
  FakeEventSource.instances = [];

  const router = createMemoryRouter(
    [{ path: "/gallery", element: <GalleryPage /> }],
    { initialEntries: [initialEntry] },
  );
  return render(<RouterProvider router={router} />);
}

const SUBMISSION_1 = {
  submissionId: "sub1",
  modelId: "m1",
  modelSlug: "ltx",
  modelName: "LTX 2.5",
  modeId: "mode1",
  modeName: "Default",
  submittedAt: new Date().toISOString(),
  generations: [
    {
      id: "g1",
      modelId: "m1",
      modeId: "mode1",
      modeName: "Default",
      submissionId: "sub1",
      state: "succeeded",
      error: null,
      submittedAt: new Date().toISOString(),
      assets: [
        {
          id: "a1",
          nodeId: "3",
          sortOrder: 0,
          kind: "image",
          contentType: "image/png",
        },
      ],
    },
  ],
};

describe("GalleryPage", () => {
  test("shows the empty state when there are no Submissions", async () => {
    mockFetch((call) => {
      if (call.url.endsWith("/api/gallery/models")) {
        return Response.json({ models: [] });
      }
      if (call.url.includes("/api/gallery?")) {
        return Response.json({ submissions: [], hasMore: false });
      }
      throw new Error(`unexpected fetch ${call.url}`);
    });

    const view = renderGallery();
    expect(await view.findByText("Nothing here yet")).toBeTruthy();
  });

  test("groups Submissions under a Today header and shows the Model link", async () => {
    mockFetch((call) => {
      if (call.url.endsWith("/api/gallery/models")) {
        return Response.json({
          models: [{ id: "m1", slug: "ltx", name: "LTX 2.5", deleted: false }],
        });
      }
      if (call.url.includes("/api/gallery?")) {
        return Response.json({ submissions: [SUBMISSION_1], hasMore: false });
      }
      throw new Error(`unexpected fetch ${call.url}`);
    });

    const view = renderGallery();
    expect(await view.findByText("Today")).toBeTruthy();
    expect(view.getByRole("link", { name: "LTX 2.5" })).toBeTruthy();
    expect(view.getByText("That's everything.")).toBeTruthy();
  });

  test("filters by Model via the URL and shows Clear filters on no match", async () => {
    mockFetch((call) => {
      if (call.url.endsWith("/api/gallery/models")) {
        return Response.json({
          models: [{ id: "m1", slug: "ltx", name: "LTX 2.5", deleted: false }],
        });
      }
      if (call.url.includes("/api/gallery?")) {
        expect(call.url).toContain("model=m1");
        return Response.json({ submissions: [], hasMore: false });
      }
      throw new Error(`unexpected fetch ${call.url}`);
    });

    const view = renderGallery("/gallery?model=m1");
    expect(await view.findByText("No Generations match.")).toBeTruthy();
    expect(view.getByRole("button", { name: "Clear filters" })).toBeTruthy();
  });

  test("a new change event for an unseen Submission prepends it when it matches no filter", async () => {
    mockFetch((call) => {
      if (call.url.endsWith("/api/gallery/models")) {
        return Response.json({ models: [] });
      }
      if (call.url.includes("/api/gallery?")) {
        return Response.json({ submissions: [], hasMore: false });
      }
      throw new Error(`unexpected fetch ${call.url}`);
    });

    const view = renderGallery();
    await view.findByText("Nothing here yet");

    await waitFor(() => expect(FakeEventSource.instances.length).toBe(1));
    const source = FakeEventSource.instances[0] as FakeEventSource;
    source.emit("change", {
      id: "g2",
      modelId: "m2",
      modelSlug: "wan",
      modelName: "Wan",
      modeId: "mode2",
      modeName: "Default",
      submissionId: "sub2",
      state: "queued",
      error: null,
      submittedAt: new Date().toISOString(),
      assets: [],
    });

    expect(await view.findByRole("link", { name: "Wan" })).toBeTruthy();
  });
});
